import { FindSolicitudTitularSocioLegacyId } from "./FindSolicitudTitularSocioLegacyId";
import { hoyEnArgentina } from "./PlanCobroRefinanciacion";
import { SolicitudCoreNotFoundError } from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { SolicitudesLegacyGateway } from "../../../solicitudes/domain/services/SolicitudesLegacyGateway";
import type { CuotaCobradaLegacy } from "../../infrastructure/services/CobrarPrestamoGateway";
import {
  buildComprobanteRefinanciacionPdf,
  type ComprobanteRefinanciacion,
} from "../../infrastructure/services/ComprobanteRefinanciacionPdf";

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
  build?: typeof buildComprobanteRefinanciacionPdf;
  hoy?: () => string;
  legacyGateway: LegacyGateway;
  repository: Pick<SolicitudesCoreRepository, "findById">;
};

export type ComprobanteRefinanciacionInput = {
  prestamos: {
    /** Detalle por cuota que devolvio Vimarx al cobrar o simular. */
    cuotas: CuotaCobradaLegacy[];
    /** ID del cobro en Vimarx; "0" en una simulacion. */
    numero: string;
    prestamoId: string;
  }[];
  simulacion: boolean;
  solicitudId: string;
};

/**
 * Arma el comprobante "REFINANCIACION DE CREDITO" (el "Prestamos Pagos" de
 * Vimarx) de uno o mas cobros, una pagina por cobro.
 *
 * Las columnas salen igual que en Vimarx: Capital e Interes son los de la
 * cuota en el plan; "Credito Pago Adel." es el interes que no se cobra por
 * pagar antes del vencimiento; Gastos Administrativos es el cargo de
 * refinanciacion de la linea; Total General, lo cobrado. Verificado contra
 * la simulacion de la pantalla del 28/10/2026 (prestamo 416228, 340705,34).
 */
export class ComprobanteRefinanciacionService {
  private readonly build: typeof buildComprobanteRefinanciacionPdf;
  private readonly findSocioLegacyId: FindSolicitudTitularSocioLegacyId;
  private readonly hoy: () => string;
  private readonly legacyGateway: LegacyGateway;
  private readonly repository: Pick<SolicitudesCoreRepository, "findById">;

  constructor(dependencies: Dependencies) {
    this.build = dependencies.build ?? buildComprobanteRefinanciacionPdf;
    this.findSocioLegacyId = new FindSolicitudTitularSocioLegacyId({
      gateway: dependencies.legacyGateway,
    });
    this.hoy = dependencies.hoy ?? (() => hoyEnArgentina());
    this.legacyGateway = dependencies.legacyGateway;
    this.repository = dependencies.repository;
  }

  async armar(input: ComprobanteRefinanciacionInput): Promise<Buffer> {
    const solicitud = await this.repository.findById(input.solicitudId);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    const titular = solicitud.titular;
    const socioLegacyId = await this.findSocioLegacyId.execute(titular);
    const fecha = fechaArgentina(this.hoy());
    const comprobantes: ComprobanteRefinanciacion[] = [];

    for (const item of input.prestamos) {
      const prestamo = socioLegacyId
        ? await this.legacyGateway.getPrestamoDelSocio(
            socioLegacyId,
            item.prestamoId,
          )
        : null;
      const plan = new Map(
        (await this.legacyGateway.listCuotasDelPrestamo(item.prestamoId))
          .filter((cuota) => typeof cuota.nroCuota === "number")
          .map((cuota) => [cuota.nroCuota as number, cuota]),
      );

      comprobantes.push({
        cuotas: item.cuotas.map((cobrada) => {
          const cuota = plan.get(cobrada.nroCuota);
          // Sin el plan se reconstruye desde el cobro: lo que no es interes,
          // punitorios ni cargo, es capital.
          const capital =
            cuota?.capital ??
            cobrada.totalPagado -
              cobrada.interesPagado -
              cobrada.punitoriosPagados -
              cobrada.otrosPagado;
          const interes =
            cuota?.montoTotal != null && cuota.capital != null
              ? cuota.montoTotal - cuota.capital
              : cobrada.interesPagado;

          return {
            capital: redondear(capital),
            creditoPagoAdelantado: redondear(
              Math.max(0, interes - cobrada.interesPagado),
            ),
            gastos: redondear(cobrada.otrosPagado),
            interes: redondear(interes),
            nroCuota: cobrada.nroCuota,
            punitorios: redondear(cobrada.punitoriosPagados),
            total: redondear(cobrada.totalPagado),
            vencimiento: fechaArgentina(cobrada.fechaVto ?? cuota?.fecha ?? null),
          };
        }),
        documento: titular.nroDocumento?.trim() || titular.cuit?.trim() || "-",
        domicilio:
          [titular.domicilioCalle, titular.nroPuerta]
            .map((parte) => parte?.trim())
            .filter(Boolean)
            .join(" ") || "-",
        fecha,
        linea: prestamo?.lineaPrestamoDescripcion?.trim() || "",
        localidad: titular.localidad?.trim() || "",
        numero: item.numero,
        operacion: prestamo?.nroCuenta?.trim() || item.prestamoId,
        socio:
          [titular.apellidoDenominacion, titular.nombre]
            .map((parte) => parte?.trim())
            .filter(Boolean)
            .join(" ")
            .toUpperCase() || "-",
      });
    }

    return this.build(comprobantes, { simulacion: input.simulacion });
  }
}

// "2026-09-30" o "2026-09-30T00:00:00" -> "30/09/2026".
function fechaArgentina(valor: string | null) {
  const match = valor ? /^(\d{4})-(\d{2})-(\d{2})/.exec(valor) : null;

  return match ? `${match[3]}/${match[2]}/${match[1]}` : "-";
}

function redondear(valor: number) {
  return Math.round(valor * 100) / 100;
}
