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

  async simular(input: SimularPrestamoGatewayInput): Promise<SimulacionPrestamo> {
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
      throw new PrestamoSimulacionRechazadaError(this.extractErrorMessage(body));
    }

    return this.mapResponse(body);
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
        row.FechaPrimerVencimiento === null || row.FechaPrimerVencimiento === undefined
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
