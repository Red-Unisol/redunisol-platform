import {
  PrestamoLegacyRechazadoError,
  SolicitudRefinanciacionCobroIncompletoError,
  SolicitudRefinanciacionInvalidaError,
} from "../../domain/solicitudes-core-errors";
import {
  cuotasPendientesDeCobro,
  refinanciacionVersion,
  type SolicitudRefinanciacionPrestamo,
  type SolicitudRefinanciacionRepository,
} from "../../domain/repositories/SolicitudRefinanciacionRepository";
import type { SolicitudesLegacyGateway } from "../../../solicitudes/domain/services/SolicitudesLegacyGateway";
import type { CobrarPrestamoGateway } from "../../infrastructure/services/CobrarPrestamoGateway";
import {
  COBRADOR_REFINANCIACION_ID,
  MOTIVO_COBRO_REFINANCIACION,
  type SimularRefinanciacionUseCase,
} from "../use-cases/SimularRefinanciacion.use-case";
import {
  hoyEnArgentina,
  planCobroRefinanciacion,
} from "./PlanCobroRefinanciacion";
import type { RefinanciacionCobrosService } from "../../infrastructure/services/RefinanciacionCobrosService";
import type { LoanDiagnosticContext } from "../../../technical-diagnostics/LoanDiagnostics";
import { AdministrativeCorrectionError } from "../../domain/workflow/AdministrativeCorrection";

type Dependencies = {
  cobrarPrestamoGateway: Pick<CobrarPrestamoGateway, "cobrar">;
  hoy?: () => string;
  legacyGateway: Pick<SolicitudesLegacyGateway, "listCuotasDelPrestamo">;
  refinanciacionRepository: Pick<
    SolicitudRefinanciacionRepository,
    "findBySolicitudId"
  >;
  registroCobros: Pick<RefinanciacionCobrosService, "iniciar" | "confirmar" | "rechazar" | "marcarIncierto">;
  simularRefinanciacion: Pick<SimularRefinanciacionUseCase, "execute">;
};

export type RefinanciacionPreparada = {
  version: string;
  /** Por prestamo, las cuotas elegidas que todavia no se cobraron. */
  pendientes: SolicitudRefinanciacionPrestamo[];
  /** Lo cobrado + lo que Vimarx calcula hoy para lo pendiente. */
  total: number;
};

/**
 * Cobra en Vimarx las cuotas guardadas en la pestaña Refinanciacion, antes de
 * crear el prestamo nuevo. Con el motivo y el cobrador de refinanciacion la
 * contrapartida va a la cuenta Refinanciacion, y CrearPrestamo la descuenta
 * sola del en mano (verificado en FapiTest el 27/10/2026: prestamo 441211).
 *
 * Por prestamo hace uno o dos cobros, como un analista: las vencidas aparte,
 * con punitorios, y el resto fuera de orden (ver PlanCobroRefinanciacion).
 *
 * En dos pasos para no escribir nada hasta saber que todo cierra: preparar()
 * solo simula, y cobrar() escribe. Cada cobro se registra apenas Vimarx lo
 * confirma: si falla uno a mitad de camino, al reintentar no se vuelven a
 * cobrar esas cuotas.
 */
export class CobrarRefinanciacionSolicitud {
  private readonly dependencies: Dependencies;
  private readonly hoy: () => string;

  constructor(dependencies: Dependencies) {
    this.dependencies = dependencies;
    this.hoy = dependencies.hoy ?? (() => hoyEnArgentina());
  }

  async preparar(solicitudId: string): Promise<RefinanciacionPreparada> {
    const guardada =
      await this.dependencies.refinanciacionRepository.findBySolicitudId(
        solicitudId,
      );
    const pendientes = guardada.prestamos
      .map((prestamo) => ({
        nrosCuota: cuotasPendientesDeCobro(prestamo),
        prestamoId: prestamo.prestamoId,
      }))
      .filter((prestamo) => prestamo.nrosCuota.length > 0);
    const cobrado = guardada.prestamos
      .flatMap((prestamo) => prestamo.cobros)
      .reduce((total, cobro) => total + cobro.totalCobrado, 0);

    if (pendientes.length === 0) {
      return { pendientes, total: roundToCents(cobrado), version: refinanciacionVersion(guardada) };
    }

    // Tambien vuelve a verificar que cada prestamo sea del titular.
    const simulacion = await this.dependencies.simularRefinanciacion.execute({
      prestamos: pendientes,
      solicitudId,
    });
    const rechazo = simulacion.prestamos.find((prestamo) => !prestamo.ok);

    if (rechazo && !rechazo.ok) {
      throw new SolicitudRefinanciacionInvalidaError(
        `Vimarx no acepta la refinanciación del préstamo ${rechazo.prestamoId}: ${rechazo.error}`,
      );
    }

    return {
      version: refinanciacionVersion(guardada),
      pendientes,
      total: roundToCents(cobrado + (simulacion.total ?? 0)),
    };
  }

  async cobrar(solicitudId: string, preparada: RefinanciacionPreparada, context?: LoanDiagnosticContext) {
    const hoy = this.hoy();
    const tramos = [];

    for (const prestamo of preparada.pendientes) {
      const cuotas =
        await this.dependencies.legacyGateway.listCuotasDelPrestamo(
          prestamo.prestamoId,
        );

      for (const tramo of planCobroRefinanciacion(
        prestamo.nrosCuota,
        cuotas,
        hoy,
      )) {
        tramos.push({ ...tramo, prestamoId: prestamo.prestamoId });
      }
    }

    for (const [index, tramo] of tramos.entries()) {
      const operationId = await this.dependencies.registroCobros.iniciar({
        solicitudId, prestamoId: tramo.prestamoId, nrosCuota: tramo.nrosCuota, context,
      });
      let cobro;

      try {
        cobro = await this.dependencies.cobrarPrestamoGateway.cobrar({
          cobradorId: COBRADOR_REFINANCIACION_ID,
          motivo: MOTIVO_COBRO_REFINANCIACION,
          nrosCuota: tramo.nrosCuota,
          permitePagoFueraDeOrden: tramo.permitePagoFueraDeOrden,
          prestamoId: tramo.prestamoId,
          simulacion: false,
        });
      } catch (error) {
        if (error instanceof PrestamoLegacyRechazadoError) {
          await this.dependencies.registroCobros.rechazar(solicitudId, operationId, error.message);
        } else {
          // Even if this write fails, the intent persisted before the HTTP call remains locked.
          try { await this.dependencies.registroCobros.marcarIncierto(solicitudId, operationId); } catch { /* PENDING is also uncertain. */ }
          const blocked = new AdministrativeCorrectionError("Vimarx no confirmó el cobro de refinanciación. La solicitud quedó bloqueada: un administrador debe revisar y conciliar el cobro antes de reintentar.");
          blocked.cause = error;
          throw blocked;
        }
        const cuotas = `las cuotas ${tramo.nrosCuota.join(", ")} del préstamo ${tramo.prestamoId}`;

        throw new SolicitudRefinanciacionCobroIncompletoError({
          cobrados: index,
          motivo: `Vimarx rechazó ${cuotas}: ${error.message}`,
          total: tramos.length,
        });
      }

      const confirmed = {
        cobroId: cobro.cobroId,
        nrosCuota: tramo.nrosCuota,
        totalCobrado: cobro.totalPago,
      };
      try {
        await this.dependencies.registroCobros.confirmar(solicitudId, operationId, confirmed);
      } catch (error) {
        try { await this.dependencies.registroCobros.marcarIncierto(solicitudId, operationId, confirmed); } catch { /* The durable intent must never be released. */ }
        const blocked = new AdministrativeCorrectionError(`No se pudo registrar el cobro ${confirmed.cobroId} de refinanciación. La solicitud quedó bloqueada hasta que un administrador lo concilie.`, 502);
        blocked.cause = error;
        throw blocked;
      }
    }
  }
}

function roundToCents(value: number) {
  return Math.round(value * 100) / 100;
}
