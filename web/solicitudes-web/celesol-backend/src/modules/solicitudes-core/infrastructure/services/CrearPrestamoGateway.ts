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

type CrearPrestamoGatewayConfig = {
  baseUrl: string;
  timeoutMs: number;
};

export type CrearPrestamoIntegrante = {
  socio: string;
  tipoRelacion: "Titular";
};

export type CrearPrestamoInput = {
  cuotas: number;
  fechaEmision: string;
  integrantes: CrearPrestamoIntegrante[];
  /**
   * ID de F.Module.Cuentas.Prestamos.LineaPrestamo -- NO el Oid de
   * PreSolicitud.Module.LineaPrestamoPresolicitud que guarda la solicitud.
   * Lo traduce LineaPrestamoLegacyIdResolver antes de llegar aca.
   */
  lineaPrestamo: string;
  /** Numerico a proposito: como texto el legado lo descarta. Ver abajo. */
  montoDeseado: number;
  vendedor: string;
};

export type CrearPrestamoResult = {
  id: string;
};

const CREAR_PRESTAMO_PATH = "/api/Simulador/CrearPrestamo";

export class CrearPrestamoGateway {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(config: CrearPrestamoGatewayConfig, fetcher: Fetcher = fetch) {
    this.baseUrl = config.baseUrl;
    this.fetcher = fetcher;
    this.timeoutMs = config.timeoutMs;
  }

  async crear(input: CrearPrestamoInput): Promise<CrearPrestamoResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Awaited<ReturnType<Fetcher>>;

    try {
      response = await this.fetcher(
        new URL(CREAR_PRESTAMO_PATH, this.baseUrl),
        {
          // ATENCION: EL ORDEN DE ESTAS CLAVES ES SIGNIFICATIVO. NO ORDENAR
          // ALFABETICAMENTE.
          //
          // El legado aplica el bloque `campos` en el orden en que llega, y
          // asignar LineaPrestamo RESETEA Cuotas al minimo de esa linea. Con
          // Cuotas antes (que es donde lo deja el orden alfabetico) el valor
          // que mandamos se pierde siempre: el prestamo se creaba con el
          // minimo de la linea -- 1 cuota para AMEJUCA ESPECIAL, 6 para CAJA
          // PREMIUM +1 -- sin devolver ningun error.
          //
          // MontoDeseado va como numero, no como texto: en string el legado lo
          // descarta y el prestamo queda en 0,00, tambien en silencio.
          //
          // Verificado contra el ambiente real (prestamo 440143): con este
          // orden y estos tipos, sale con 36 cuotas y $6.000.000. Con Cuotas
          // arriba o el monto como string, no.
          body: JSON.stringify({
            campos: {
              FechaEmision: input.fechaEmision,
              Integrantes: input.integrantes.map((integrante) => ({
                Socio: integrante.socio,
                TipoRelacion: integrante.tipoRelacion,
              })),
              LineaPrestamo: input.lineaPrestamo,
              Cuotas: input.cuotas,
              MontoDeseado: input.montoDeseado,
              Vendedor: input.vendedor,
            },
            validar: false,
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

  private parseResponse(body: unknown): CrearPrestamoResult {
    const row = body as Record<string, unknown>;

    if (row.Ok !== true) {
      const message =
        typeof row.Error === "string" && row.Error.trim().length > 0
          ? row.Error
          : "No se pudo dar de alta el préstamo en el legado.";

      throw new PrestamoLegacyRechazadoError(message);
    }

    return { id: String(row.ID) };
  }
}
