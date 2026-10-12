import {
  LegacySolicitudesUnavailableError,
  PrestamoSimulacionRechazadaError,
} from "../../domain/solicitudes-errors";

type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
}>;

type PrestamosSimulacionGatewayConfig = {
  baseUrl: string;
  timeoutMs: number;
};

export type SimularPrestamoGatewayInput = {
  capitalPuro: boolean;
  cuotas: number;
  fechaPrimerVencimiento?: string;
  lineaId: number;
  montoAFinanciar: number;
  tasa?: number;
};

export type SimulacionPrestamoCuota = {
  capital: number;
  fechaVencimiento: string;
  gastos: number;
  interes: number;
  numeroCuota: number;
  total: number;
};

export type SimulacionPrestamo = {
  capital: number;
  capitalPuro: boolean;
  cuotaResultante: number;
  cuotas: number;
  cuotasDetalle: SimulacionPrestamoCuota[] | null;
  fechaPrimerVencimiento: string | null;
  fechaUltimaCuota: string;
  gastos: number;
  intereses: number;
  iva: number;
  lineaDescripcion: string | null;
  lineaId: number;
  montoAFinanciar: number;
  montoSujetoASellado: number;
  sellado: number;
  tasa: number;
  tem: number;
  total: number;
};

export class PrestamosSimulacionGateway {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(
    config: PrestamosSimulacionGatewayConfig,
    fetcher: Fetcher = fetch,
  ) {
    this.baseUrl = config.baseUrl;
    this.fetcher = fetcher;
    this.timeoutMs = config.timeoutMs;
  }

  async simular(
    input: SimularPrestamoGatewayInput,
  ): Promise<SimulacionPrestamo> {
    return this.mapResponse(await this.request(input));
  }

  async simularRevision(
    input: SimularPrestamoGatewayInput,
  ): Promise<RevisionSimulacion> {
    const body = await this.request(input);
    if (body && typeof body === "object") {
      const row = body as Record<string, unknown>;
      for (const [key, expected] of [
        ["LineaId", input.lineaId],
        ["MontoAFinanciar", input.montoAFinanciar],
        ["Cuotas", input.cuotas],
      ] as const) {
        if (row[key] != null && Number(row[key]) !== expected) {
          throw new PrestamoSimulacionRechazadaError(
            "El cálculo recibido no corresponde a las condiciones actuales de la solicitud.",
          );
        }
      }
    }
    return mapRevisionSimulacion(body);
  }

  private async request(input: SimularPrestamoGatewayInput): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Awaited<ReturnType<Fetcher>>;

    try {
      response = await this.fetcher(
        new URL("/api/prestamos/simulacion", this.baseUrl),
        {
          body: JSON.stringify({
            capitalPuro: input.capitalPuro,
            cuotas: input.cuotas,
            fechaPrimerVencimiento: input.fechaPrimerVencimiento,
            lineaId: input.lineaId,
            montoAFinanciar: input.montoAFinanciar,
            tasa: input.tasa,
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
      throw new LegacySolicitudesUnavailableError();
    }

    clearTimeout(timeoutId);

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new LegacySolicitudesUnavailableError();
    }

    if (response.status >= 500) {
      throw new LegacySolicitudesUnavailableError();
    }

    if (!response.ok) {
      throw new PrestamoSimulacionRechazadaError(
        this.extractErrorMessage(body),
      );
    }

    return body;
  }

  private extractErrorMessage(body: unknown): string {
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      body.error &&
      typeof body.error === "object" &&
      "message" in body.error &&
      typeof (body.error as { message: unknown }).message === "string"
    ) {
      return (body.error as { message: string }).message;
    }

    return "No se pudo simular el préstamo.";
  }

  private mapResponse(body: unknown): SimulacionPrestamo {
    const row = body as Record<string, unknown>;
    const cuotasDetalleRaw = row.CuotasDetalle;
    const cuotasDetalle = Array.isArray(cuotasDetalleRaw)
      ? cuotasDetalleRaw.map((cuota) => {
          const cuotaRow = cuota as Record<string, unknown>;

          return {
            capital: Number(cuotaRow.Capital),
            fechaVencimiento: String(cuotaRow.FechaVencimiento),
            gastos: Number(cuotaRow.Gastos),
            interes: Number(cuotaRow.Interes),
            numeroCuota: Number(cuotaRow.NumeroCuota),
            total: Number(cuotaRow.Total),
          };
        })
      : null;

    return {
      capital: Number(row.Capital),
      capitalPuro: Boolean(row.CapitalPuro),
      cuotaResultante: Number(row.CuotaResultante),
      cuotas: Number(row.Cuotas),
      cuotasDetalle,
      fechaPrimerVencimiento:
        row.FechaPrimerVencimiento === null ||
        row.FechaPrimerVencimiento === undefined
          ? null
          : String(row.FechaPrimerVencimiento),
      fechaUltimaCuota: String(row.FechaUltimaCuota),
      gastos: Number(row.Gastos),
      intereses: Number(row.Intereses),
      iva: Number(row.IVA),
      lineaDescripcion:
        row.LineaDescripcion === null || row.LineaDescripcion === undefined
          ? null
          : String(row.LineaDescripcion),
      lineaId: Number(row.LineaId),
      montoAFinanciar: Number(row.MontoAFinanciar),
      montoSujetoASellado: Number(row.MontoSujetoASellado),
      sellado: Number(row.Sellado),
      tasa: Number(row.Tasa),
      tem: Number(row.TEM),
      total: Number(row.Total),
    };
  }
}

// La revisión conserva los datos ausentes, sin convertir null en un importe cero.
export type RevisionSimulacion = {
  capital: number | null;
  cuotaResultante: number | null;
  cuotas: number | null;
  gastos: number | null;
  tasa: number | null;
  total: number | null;
  fechaPrimerVencimiento: string | null;
  fechaUltimaCuota: string | null;
  cuotasDetalle:
    | {
        capital: number | null;
        fechaVencimiento: string | null;
        gastos: number | null;
        interes: number | null;
        numeroCuota: number | null;
        total: number | null;
      }[]
    | null;
};

function mapRevisionSimulacion(body: unknown): RevisionSimulacion {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new LegacySolicitudesUnavailableError();
  }
  const row = body as Record<string, unknown>;
  const number = (value: unknown): number | null => {
    if (
      value === null ||
      value === undefined ||
      (typeof value === "string" && !value.trim()) ||
      (typeof value !== "number" && typeof value !== "string")
    )
      return null;
    return Number.isFinite(Number(value)) ? Number(value) : null;
  };
  const date = (value: unknown): string | null =>
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Date.parse(value))
      ? value
      : null;
  return {
    capital: number(row.Capital),
    cuotaResultante: number(row.CuotaResultante),
    cuotas: number(row.Cuotas),
    gastos: number(row.Gastos),
    tasa: number(row.Tasa),
    total: number(row.Total),
    fechaPrimerVencimiento: date(row.FechaPrimerVencimiento),
    fechaUltimaCuota: date(row.FechaUltimaCuota),
    cuotasDetalle: Array.isArray(row.CuotasDetalle)
      ? row.CuotasDetalle.map((item) => {
          const cuota =
            item && typeof item === "object"
              ? (item as Record<string, unknown>)
              : {};
          return {
            capital: number(cuota.Capital),
            fechaVencimiento: date(cuota.FechaVencimiento),
            gastos: number(cuota.Gastos),
            interes: number(cuota.Interes),
            numeroCuota: number(cuota.NumeroCuota),
            total: number(cuota.Total),
          };
        })
      : null,
  };
}
