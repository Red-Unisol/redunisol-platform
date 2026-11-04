import { FindSolicitudTitularSocioLegacyId } from "./FindSolicitudTitularSocioLegacyId";
import { hoyEnArgentina } from "./PlanCobroRefinanciacion";
import {
  SolicitudCoreNotFoundError,
  SolicitudRefinanciacionInvalidaError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { SolicitudesLegacyGateway } from "../../../solicitudes/domain/services/SolicitudesLegacyGateway";
import type { CuotaPrestamoLegacy } from "../../../solicitudes/domain/entities/Solicitud.entity";
import type { CuotaCobradaLegacy } from "../../infrastructure/services/CobrarPrestamoGateway";
import {
  buildComprobanteRefinanciacionPdf,
  type ComprobanteRefinanciacion,
  type ComprobanteRefinanciacionCuota,
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
  /** "YYYY-MM-DD": la fecha de calculo del cobro. Sin ella, hoy. */
  fecha?: string;
  prestamos: {
    /** Detalle por cuota que devolvio Vimarx al cobrar o simular. */
    cuotas: CuotaCobradaLegacy[];
    /** ID del cobro en Vimarx; "0" en una simulacion. */
    numero: string;
    prestamoId: string;
    /** TotalPago de Vimarx: lo que se cobra (o se cobraria) del prestamo. */
    totalPago: number;
  }[];
  simulacion: boolean;
  solicitudId: string;
};

/**
 * Arma el comprobante "REFINANCIACION DE CREDITO" (el "Prestamos Pagos" de
 * Vimarx) de uno o mas cobros, una pagina por cobro.
 *
 * Cada renglon es lo que se cobra ahora de la cuota, tomado del plan de
 * Vimarx en ese momento: el saldo de la cuota con los punitorios al dia
 * (SaldoCuotaConPunitorios; en las cuotas que no vencieron ya viene sin el
 * interes que no corrio). Capital es lo que queda de capital; Interes, el
 * resto del saldo; "Credito Pago Adel.", el interes que no se cobra. Lo que
 * le falta a la suma para llegar al TotalPago de Vimarx es el cargo de
 * refinanciacion de la linea (Gastos Administrativos), y va en la ultima
 * cuota, como en Vimarx.
 *
 * No se usa el detalle por cuota que devuelve /api/Prestamo/cobrar: en una
 * cuota con pagos anteriores trae lo pagado en toda su historia, no lo de
 * este cobro (verificado en FapiTest el 2/11/2026, prestamo 418720; en prod
 * el comprobante del 389291 sumaba 14407,11 para un cobro de 10749,01).
 *
 * Si la suma no cierra con el TotalPago (el resto da negativo o mas que el
 * cargo), no se arma: un comprobante tiene que decir lo que se cobra.
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
    const hoy = this.hoy();
    const fecha = fechaArgentina(input.fecha ?? hoy);
    // El plan de Vimarx viene calculado a hoy. Con otra fecha de calculo cada
    // renglon se calcula a esa fecha.
    const fechaCalculo = input.fecha && input.fecha !== hoy ? input.fecha : null;
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
        cuotas: cuotasDelComprobante(item, plan, fechaCalculo),
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

/**
 * Tope del cargo de refinanciacion sobre lo cobrado de las cuotas. Las lineas
 * cobran 2,5 % o nada (novedad "Cargo Adm. Refinanciacion", motivo 1); el
 * margen es para que un cambio menor de la linea no frene el comprobante.
 */
const CARGO_MAXIMO = 0.03;

function cuotasDelComprobante(
  item: ComprobanteRefinanciacionInput["prestamos"][number],
  plan: Map<number, CuotaPrestamoLegacy>,
  fechaCalculo: string | null,
): ComprobanteRefinanciacionCuota[] {
  const ordenadas = [...item.cuotas].sort((a, b) => a.nroCuota - b.nroCuota);
  const filas = ordenadas.map((cobrada) => {
    const cuota = plan.get(cobrada.nroCuota);

    if (
      !cuota ||
      cuota.saldoCuota == null ||
      cuota.saldoCuotaConPunitorios == null
    ) {
      throw new SolicitudRefinanciacionInvalidaError(
        `No se pudo armar el comprobante: falta la cuota ${cobrada.nroCuota} del préstamo ${item.prestamoId} en Vimarx.`,
      );
    }

    const saldo = cuota.saldoCuota;
    const capital = Math.min(cuota.capital ?? saldo, saldo);
    const aCobrar = fechaCalculo
      ? aCobrarALaFecha(cuota, cobrada, fechaCalculo, item.prestamoId)
      : cuota.saldoCuotaConPunitorios;

    return {
      capital: redondear(capital),
      creditoPagoAdelantado: redondear(Math.max(0, saldo - aCobrar)),
      gastos: 0,
      interes: redondear(saldo - capital),
      nroCuota: cobrada.nroCuota,
      punitorios: redondear(Math.max(0, aCobrar - saldo)),
      total: redondear(aCobrar),
      vencimiento: fechaArgentina(cobrada.fechaVto ?? cuota.fecha ?? null),
    };
  });
  const suma = filas.reduce((total, fila) => total + fila.total, 0);
  const cargo = redondear(item.totalPago - suma);

  if (cargo < -0.01 || cargo > suma * CARGO_MAXIMO + 0.01) {
    throw new SolicitudRefinanciacionInvalidaError(
      `No se pudo armar el comprobante del préstamo ${item.prestamoId}: las cuotas suman ${suma.toFixed(2)} y Vimarx cobra ${item.totalPago.toFixed(2)}.`,
    );
  }

  const ultima = filas.at(-1);

  if (ultima && cargo > 0) {
    ultima.gastos = cargo;
    ultima.total = redondear(ultima.total + cargo);
  }

  return filas;
}

/**
 * Lo que Vimarx cobra de la cuota a la fecha de calculo, con las mismas reglas
 * que aplica a hoy en SaldoCuotaConPunitorios (verificado en FapiTest el
 * 4/11/2026, prestamo 418720, y en prod con el 435844):
 *
 * - vencida a esa fecha: el saldo mas los punitorios a esa fecha. Vimarx los
 *   informa en el cobro sumados a los que ya se pagaron, que se descuentan;
 * - vence en el mismo mes: el saldo entero;
 * - vence en un mes posterior: solo lo que queda de capital (el interes se
 *   bonifica). Ej.: la cuota que vence el 30/11 calculada al 31/10.
 *
 * Si no cierra con el TotalPago, el comprobante no se arma (ver abajo).
 */
function aCobrarALaFecha(
  cuota: CuotaPrestamoLegacy,
  cobrada: CuotaCobradaLegacy,
  fechaCalculo: string,
  prestamoId: string,
) {
  const saldo = cuota.saldoCuota ?? 0;
  const vencimiento = (cobrada.fechaVto ?? cuota.fecha ?? "").slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimiento)) {
    throw new SolicitudRefinanciacionInvalidaError(
      `No se pudo armar el comprobante: falta el vencimiento de la cuota ${cobrada.nroCuota} del préstamo ${prestamoId} en Vimarx.`,
    );
  }

  if (vencimiento < fechaCalculo) {
    const punitorios = cobrada.punitoriosPagados - (cuota.punitoriosPagos ?? 0);

    return saldo + Math.max(0, punitorios);
  }

  if (vencimiento.slice(0, 7) === fechaCalculo.slice(0, 7)) {
    return saldo;
  }

  return Math.min(
    cuota.saldoCuotaCapital ?? cuota.capital ?? saldo,
    saldo,
  );
}

// "2026-09-30" o "2026-09-30T00:00:00" -> "30/09/2026".
function fechaArgentina(valor: string | null) {
  const match = valor ? /^(\d{4})-(\d{2})-(\d{2})/.exec(valor) : null;

  return match ? `${match[3]}/${match[2]}/${match[1]}` : "-";
}

function redondear(valor: number) {
  return Math.round(valor * 100) / 100;
}
