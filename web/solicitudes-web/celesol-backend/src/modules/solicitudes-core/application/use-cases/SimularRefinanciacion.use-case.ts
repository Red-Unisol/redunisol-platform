import { FindSolicitudTitularSocioLegacyId } from "../services/FindSolicitudTitularSocioLegacyId";
import {
  hoyEnArgentina,
  planCobroRefinanciacion,
} from "../services/PlanCobroRefinanciacion";
import {
  PrestamoDelSocioNotFoundError,
  PrestamoLegacyRechazadoError,
  SolicitudCoreNotFoundError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { SolicitudesLegacyGateway } from "../../../solicitudes/domain/services/SolicitudesLegacyGateway";
import type {
  CobrarPrestamoGateway,
  CuotaCobradaLegacy,
} from "../../infrastructure/services/CobrarPrestamoGateway";

/**
 * Motivo "Refinanciacion" del enum MotivoAjuste de Vimarx. Es el que ponen los
 * analistas al cobrar una refinanciacion desde la pantalla, y el que hace que
 * se aplique la novedad "Cargo Adm. Refinanciacion" de la linea (2,5 % en
 * AMEJUCA, DASPU, Carlos Paz, Mudon...; las lineas que no la tienen no cobran
 * cargo).
 */
export const MOTIVO_COBRO_REFINANCIACION = 1;

/**
 * Cobrador "Refinanciacion" (F.Module.CobradorCuenta 65, mismo ID en Fapi y en
 * FapiTest). Con este cobrador la contrapartida del cobro va a la cuenta
 * Refinanciacion, y de ahi la toma CrearPrestamo como monto refinanciado del
 * prestamo nuevo. Con otro cobrador el prestamo nuevo no la descuenta.
 */
export const COBRADOR_REFINANCIACION_ID = 65;

type LegacyGateway = Pick<
  SolicitudesLegacyGateway,
  "getPrestamoDelSocio" | "listCuotasDelPrestamo"
> & {
  lookupSocioRapido(
    documento: string,
    tipoDocumento?: string,
  ): Promise<{ id: string }[]>;
};

type Dependencies = {
  cobrarPrestamoGateway: Pick<CobrarPrestamoGateway, "cobrar">;
  /** "YYYY-MM-DD" en Argentina; separa las cuotas vencidas. */
  hoy?: () => string;
  legacyGateway: LegacyGateway;
  repository: Pick<SolicitudesCoreRepository, "findById">;
};

export type SimularRefinanciacionInput = {
  prestamos: { nrosCuota: number[]; prestamoId: string }[];
  solicitudId: string;
};

export type RefinanciacionPrestamoSimulado =
  | {
      cuotas: CuotaCobradaLegacy[];
      ok: true;
      otros: number;
      prestamoId: string;
      punitorios: number;
      totalPago: number;
    }
  | {
      /** Mensaje de Vimarx, por ejemplo la cuota que falta pagar antes. */
      error: string;
      ok: false;
      prestamoId: string;
    };

export type RefinanciacionSimulada = {
  prestamos: RefinanciacionPrestamoSimulado[];
  /** null si algun prestamo no se pudo simular: el total no estaria completo. */
  total: number | null;
};

/**
 * Calcula lo que costaria cancelar las cuotas elegidas de los prestamos del
 * titular, con el motivo y el cobrador de una refinanciacion. No guarda nada:
 * Vimarx corre el cobro en modo simulacion.
 */
export class SimularRefinanciacionUseCase {
  private readonly cobrarPrestamoGateway: Pick<CobrarPrestamoGateway, "cobrar">;
  private readonly findSocioLegacyId: FindSolicitudTitularSocioLegacyId;
  private readonly hoy: () => string;
  private readonly legacyGateway: LegacyGateway;
  private readonly repository: Pick<SolicitudesCoreRepository, "findById">;

  constructor(dependencies: Dependencies) {
    this.cobrarPrestamoGateway = dependencies.cobrarPrestamoGateway;
    this.hoy = dependencies.hoy ?? (() => hoyEnArgentina());
    this.findSocioLegacyId = new FindSolicitudTitularSocioLegacyId({
      gateway: dependencies.legacyGateway,
    });
    this.legacyGateway = dependencies.legacyGateway;
    this.repository = dependencies.repository;
  }

  async execute(
    input: SimularRefinanciacionInput,
  ): Promise<RefinanciacionSimulada> {
    const solicitud = await this.repository.findById(input.solicitudId);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    // Se interpolan en la expresion de criterios del legado: solo enteros.
    if (input.prestamos.some((item) => !/^\d+$/.test(item.prestamoId.trim()))) {
      throw new PrestamoDelSocioNotFoundError();
    }

    const socioLegacyId = await this.findSocioLegacyId.execute(
      solicitud.titular,
    );

    if (!socioLegacyId) {
      throw new PrestamoDelSocioNotFoundError();
    }

    // Primero se verifica que todos los prestamos sean del titular, y recien
    // despues se simula: no se le pide a Vimarx el cobro de un prestamo ajeno.
    for (const item of input.prestamos) {
      const prestamo = await this.legacyGateway.getPrestamoDelSocio(
        socioLegacyId,
        item.prestamoId.trim(),
      );

      if (!prestamo) {
        throw new PrestamoDelSocioNotFoundError();
      }
    }

    const prestamos: RefinanciacionPrestamoSimulado[] = [];
    const hoy = this.hoy();

    for (const item of input.prestamos) {
      const prestamoId = item.prestamoId.trim();
      const cuotas = await this.legacyGateway.listCuotasDelPrestamo(prestamoId);
      // Uno o dos cobros, como en la pantalla: las vencidas con punitorios y
      // el resto fuera de orden. Se informan juntos, por prestamo.
      const tramos = planCobroRefinanciacion(item.nrosCuota, cuotas, hoy);

      try {
        const cobros = [];

        for (const tramo of tramos) {
          cobros.push(
            await this.cobrarPrestamoGateway.cobrar({
              cobradorId: COBRADOR_REFINANCIACION_ID,
              motivo: MOTIVO_COBRO_REFINANCIACION,
              nrosCuota: tramo.nrosCuota,
              permitePagoFueraDeOrden: tramo.permitePagoFueraDeOrden,
              prestamoId,
              simulacion: true,
            }),
          );
        }

        prestamos.push({
          cuotas: cobros.flatMap((cobro) => cobro.cuotas),
          ok: true,
          otros: roundToCents(sumar(cobros, "otros")),
          prestamoId,
          punitorios: roundToCents(sumar(cobros, "punitorios")),
          totalPago: roundToCents(sumar(cobros, "totalPago")),
        });
      } catch (error) {
        // Un rechazo de Vimarx se informa en su prestamo, para que el
        // analista vea cual corregir. Si Vimarx no responde, falla todo.
        if (!(error instanceof PrestamoLegacyRechazadoError)) {
          throw error;
        }

        prestamos.push({ error: error.message, ok: false, prestamoId });
      }
    }

    const total = prestamos.every((item) => item.ok)
      ? roundToCents(
          prestamos.reduce(
            (sum, item) => sum + (item.ok ? item.totalPago : 0),
            0,
          ),
        )
      : null;

    return { prestamos, total };
  }
}

function roundToCents(value: number) {
  return Math.round(value * 100) / 100;
}

function sumar(
  cobros: { otros: number; punitorios: number; totalPago: number }[],
  campo: "otros" | "punitorios" | "totalPago",
) {
  return cobros.reduce((total, cobro) => total + cobro[campo], 0);
}
