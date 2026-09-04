import type { PrestamosSimulacionGateway } from "../../../solicitudes/infrastructure/services/PrestamosSimulacionGateway";

export type CuotaSolicitudSimulada = {
  /** Formato argentino con dos decimales: "677.916,20". */
  cuotaResultante: string;
  /** "2026-10-31" */
  fechaPrimerVencimiento: string;
};

type SimularCuotaSolicitudInput = {
  cuotas: number | null;
  fechaPrimerVencimiento: string | null;
  lineaPrestamoLegacyOid: string | null;
  montoAFinanciar: number | null;
};

type Dependencies = {
  gateway: Pick<PrestamosSimulacionGateway, "simular">;
};

const cuotaFormatter = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

/**
 * Calcula la cuota resultante y la fecha del primer vencimiento pidiendoselas
 * al legado, que es quien tiene la configuracion financiera de cada linea
 * (tasa, gastos, IVA, sellado, sistema de amortizacion y regla de
 * vencimientos). Aca no se calcula nada: se consulta.
 *
 * Es el mismo endpoint que usa el simulador. La diferencia es que Vimarx
 * calcula estos dos campos al guardar la solicitud, sin que el vendedor tenga
 * que abrir ningun simulador -- verificado cargando una solicitud en el sistema
 * legado sin pasar por el -- y nosotros dependiamos de que lo abriera. Por eso
 * quedaban en null.
 *
 * BEST-EFFORT A PROPOSITO: si faltan datos o el legado no responde devuelve
 * null y el llamador sigue sin la cuota. Bloquear el alta de una solicitud
 * porque el legado esta caido dejaria al vendedor sin poder trabajar con el
 * socio delante; es preferible guardar sin el dato. Mismo criterio que el
 * reparto automatico de solicitudes.
 */
export class SimularCuotaSolicitud {
  private readonly gateway: Pick<PrestamosSimulacionGateway, "simular">;

  constructor(dependencies: Dependencies) {
    this.gateway = dependencies.gateway;
  }

  async execute(
    input: SimularCuotaSolicitudInput,
  ): Promise<CuotaSolicitudSimulada | null> {
    const lineaId = Number(input.lineaPrestamoLegacyOid);

    if (
      input.montoAFinanciar === null ||
      input.cuotas === null ||
      !Number.isFinite(lineaId) ||
      lineaId <= 0
    ) {
      return null;
    }

    try {
      const simulacion = await this.gateway.simular({
        capitalPuro: false,
        cuotas: input.cuotas,
        lineaId,
        montoAFinanciar: input.montoAFinanciar,
        // Si la solicitud ya trae una fecha elegida se respeta: cambia la
        // cuota. Si no, el legado devuelve la suya (ultimo dia del mes
        // siguiente) y la guardamos.
        ...(input.fechaPrimerVencimiento
          ? { fechaPrimerVencimiento: input.fechaPrimerVencimiento }
          : {}),
      });

      if (!Number.isFinite(simulacion.cuotaResultante)) {
        return null;
      }

      return {
        cuotaResultante: cuotaFormatter.format(simulacion.cuotaResultante),
        fechaPrimerVencimiento:
          simulacion.fechaPrimerVencimiento?.slice(0, 10) ??
          input.fechaPrimerVencimiento ??
          "",
      };
    } catch {
      return null;
    }
  }
}
