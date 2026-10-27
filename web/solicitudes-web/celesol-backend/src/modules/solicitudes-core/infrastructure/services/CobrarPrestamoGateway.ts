import {
  PrestamoLegacyRechazadoError,
  PrestamoLegacyUnavailableError,
} from "../../domain/solicitudes-core-errors";

type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
}>;

type CobrarPrestamoGatewayConfig = {
  baseUrl: string;
  timeoutMs: number;
};

export type CobrarPrestamoInput = {
  /** ID de F.Module.CobradorCuenta en Vimarx. */
  cobradorId: number;
  /** Enum MotivoAjuste de Vimarx: 0 Normal, 1 Refinanciacion, 2 Cancelacion anticipada. */
  motivo: number;
  nrosCuota: number[];
  /** ID del prestamo en Vimarx (no el NroCuenta). */
  prestamoId: string;
  simulacion: boolean;
};

export type CuotaCobradaLegacy = {
  fechaVto: string | null;
  interesPagado: number;
  nroCuota: number;
  otrosPagado: number;
  punitoriosPagados: number;
  totalPagado: number;
};

export type CobrarPrestamoResult = {
  capital: number;
  /** 0 en una simulacion. */
  cobroId: string;
  cuotas: CuotaCobradaLegacy[];
  interes: number;
  /**
   * Neto de ajustes: el interes que se anula de las cuotas que todavia no
   * vencieron, menos los cargos de la linea (el 2,5 % de una refinanciacion).
   */
  otros: number;
  punitorios: number;
  totalPago: number;
};

const COBRAR_PRESTAMO_PATH = "/api/Prestamo/cobrar";

/**
 * POST /api/Prestamo/cobrar de Fapi. No figura en el swagger publicado.
 *
 * A diferencia de /fapi/PagoDeuda: cobra varias cuotas de un prestamo en una
 * llamada, calcula el importe (pagoTotal) y recibe el motivo del cobro, que es
 * lo que dispara las novedades de la linea (el "Cargo Adm. Refinanciacion" se
 * evalua solo con motivo 1). Con simulacion no guarda nada.
 *
 * Verificado en FapiTest el 27/10/2026 (version 26.1.1008.8). El cobrador va
 * en "cobradorId": con "idCobrador", el nombre de PagoDeuda, lo ignora y usa
 * CAJA sin avisar. Exige el orden de las cuotas (empezar por la impaga mas
 * vieja) y no se encontro como saltearlo.
 */
export class CobrarPrestamoGateway {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(config: CobrarPrestamoGatewayConfig, fetcher: Fetcher = fetch) {
    this.baseUrl = config.baseUrl;
    this.fetcher = fetcher;
    this.timeoutMs = config.timeoutMs;
  }

  async cobrar(input: CobrarPrestamoInput): Promise<CobrarPrestamoResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Awaited<ReturnType<Fetcher>>;

    try {
      response = await this.fetcher(
        new URL(COBRAR_PRESTAMO_PATH, this.baseUrl),
        {
          body: JSON.stringify({
            cobradorId: input.cobradorId,
            // Numero: el legado lo espera como entero.
            idPrestamo: Number(input.prestamoId),
            motivo: input.motivo,
            nrosCuota: input.nrosCuota,
            pagoTotal: true,
            simulacion: input.simulacion,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
          signal: controller.signal,
        },
      );
    } catch {
      clearTimeout(timeoutId);
      throw new PrestamoLegacyUnavailableError();
    }

    clearTimeout(timeoutId);

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new PrestamoLegacyUnavailableError();
    }

    return this.parseResponse(body);
  }

  private parseResponse(body: unknown): CobrarPrestamoResult {
    const row = (body ?? {}) as Record<string, unknown>;

    // Los rechazos vienen como {"error":{"code","message"}} con HTTP 400; el
    // mensaje es el de Vimarx ("Deben Pagarse 1 cuota/s en prt ...").
    if (row.Success !== true) {
      const error = (row.error ?? {}) as Record<string, unknown>;
      const message =
        typeof error.message === "string" && error.message.trim().length > 0
          ? error.message.trim()
          : "El sistema legado no pudo calcular el cobro.";

      throw new PrestamoLegacyRechazadoError(message);
    }

    const cuotas = Array.isArray(row.Cuotas) ? row.Cuotas : [];

    return {
      capital: toNumber(row.Capital),
      cobroId: String(row.CobroId ?? "0"),
      cuotas: cuotas.map((cuota) => {
        const item = (cuota ?? {}) as Record<string, unknown>;

        return {
          fechaVto: typeof item.FechaVto === "string" ? item.FechaVto : null,
          interesPagado: toNumber(item.InteresPagado),
          nroCuota: toNumber(item.NroCuota),
          otrosPagado: toNumber(item.OtrosPagado),
          punitoriosPagados: toNumber(item.PunitoriosPagados),
          totalPagado: toNumber(item.TotalPagado),
        };
      }),
      interes: toNumber(row.Interes),
      otros: toNumber(row.Otros),
      punitorios: toNumber(row.Punitorios),
      totalPago: toNumber(row.TotalPago),
    };
  }
}

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
