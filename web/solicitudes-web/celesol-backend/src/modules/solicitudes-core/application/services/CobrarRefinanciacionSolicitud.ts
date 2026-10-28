import {
  PrestamoLegacyRechazadoError,
  SolicitudRefinanciacionCobroIncompletoError,
  SolicitudRefinanciacionInvalidaError,
} from "../../domain/solicitudes-core-errors";
import type {
  SolicitudRefinanciacionPrestamoGuardado,
  SolicitudRefinanciacionRepository,
} from "../../domain/repositories/SolicitudRefinanciacionRepository";
import type { CobrarPrestamoGateway } from "../../infrastructure/services/CobrarPrestamoGateway";
import {
  COBRADOR_REFINANCIACION_ID,
  MOTIVO_COBRO_REFINANCIACION,
  type SimularRefinanciacionUseCase,
} from "../use-cases/SimularRefinanciacion.use-case";

type Dependencies = {
  cobrarPrestamoGateway: Pick<CobrarPrestamoGateway, "cobrar">;
  refinanciacionRepository: Pick<
    SolicitudRefinanciacionRepository,
    "findBySolicitudId" | "marcarCobrado"
  >;
  simularRefinanciacion: Pick<SimularRefinanciacionUseCase, "execute">;
};

export type RefinanciacionPreparada = {
  /** Prestamos guardados que todavia no se cobraron en Vimarx. */
  pendientes: SolicitudRefinanciacionPrestamoGuardado[];
  /** Lo cobrado + lo que Vimarx calcula hoy para lo pendiente. */
  total: number;
};

/**
 * Cobra en Vimarx las cuotas guardadas en la pestaña Refinanciacion, antes de
 * crear el prestamo nuevo. Con el motivo y el cobrador de refinanciacion la
 * contrapartida va a la cuenta Refinanciacion, y CrearPrestamo la descuenta
 * sola del en mano (verificado en FapiTest el 27/10/2026: prestamo 441211).
 *
 * En dos pasos para no escribir nada hasta saber que todo cierra: preparar()
 * solo simula, y cobrar() escribe. Cada cobro se registra apenas Vimarx lo
 * confirma: si falla uno a mitad de camino, al reintentar no se vuelve a
 * cobrar lo que ya se cobro.
 */
export class CobrarRefinanciacionSolicitud {
  private readonly dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.dependencies = dependencies;
  }

  async preparar(solicitudId: string): Promise<RefinanciacionPreparada> {
    const guardada =
      await this.dependencies.refinanciacionRepository.findBySolicitudId(
        solicitudId,
      );
    const pendientes = guardada.prestamos.filter(
      (prestamo) => prestamo.cobro === null,
    );
    const cobrado = guardada.prestamos.reduce(
      (total, prestamo) => total + (prestamo.cobro?.totalCobrado ?? 0),
      0,
    );

    if (pendientes.length === 0) {
      return { pendientes, total: roundToCents(cobrado) };
    }

    // Tambien vuelve a verificar que cada prestamo sea del titular.
    const simulacion = await this.dependencies.simularRefinanciacion.execute({
      prestamos: pendientes.map((prestamo) => ({
        nrosCuota: prestamo.nrosCuota,
        prestamoId: prestamo.prestamoId,
      })),
      solicitudId,
    });
    const rechazo = simulacion.prestamos.find((prestamo) => !prestamo.ok);

    if (rechazo && !rechazo.ok) {
      throw new SolicitudRefinanciacionInvalidaError(
        `Vimarx no acepta la refinanciación del préstamo ${rechazo.prestamoId}: ${rechazo.error}`,
      );
    }

    return {
      pendientes,
      total: roundToCents(cobrado + (simulacion.total ?? 0)),
    };
  }

  async cobrar(solicitudId: string, preparada: RefinanciacionPreparada) {
    const total = preparada.pendientes.length;

    for (const [index, prestamo] of preparada.pendientes.entries()) {
      let cobro;

      try {
        cobro = await this.dependencies.cobrarPrestamoGateway.cobrar({
          cobradorId: COBRADOR_REFINANCIACION_ID,
          motivo: MOTIVO_COBRO_REFINANCIACION,
          nrosCuota: prestamo.nrosCuota,
          prestamoId: prestamo.prestamoId,
          simulacion: false,
        });
      } catch (error) {
        throw new SolicitudRefinanciacionCobroIncompletoError({
          cobrados: index,
          motivo:
            error instanceof PrestamoLegacyRechazadoError
              ? `Vimarx rechazó el préstamo ${prestamo.prestamoId}: ${error.message}`
              : `No se pudo confirmar el cobro del préstamo ${prestamo.prestamoId}. Antes de reintentar, revisá en Vimarx si sus cuotas quedaron cobradas.`,
          total,
        });
      }

      await this.dependencies.refinanciacionRepository.marcarCobrado({
        cobroId: cobro.cobroId,
        prestamoId: prestamo.prestamoId,
        solicitudId,
        totalCobrado: cobro.totalPago,
      });
    }
  }
}

function roundToCents(value: number) {
  return Math.round(value * 100) / 100;
}
