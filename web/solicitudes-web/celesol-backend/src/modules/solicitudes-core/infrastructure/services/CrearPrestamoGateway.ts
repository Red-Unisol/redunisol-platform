import { randomUUID } from "node:crypto";
import type { LoanDiagnosticContext, LoanDiagnosticWriter } from "../../../technical-diagnostics/LoanDiagnostics";
import {
  PrestamoLegacyRechazadoError,
  PrestamoLegacyUnavailableError,
} from "../../domain/solicitudes-core-errors";

type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{
  json(): Promise<unknown>;
  text?(): Promise<string>;
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: Pick<Headers, "forEach">;
}>;

type CrearPrestamoGatewayConfig = {
  baseUrl: string;
  timeoutMs: number;
  diagnostics?: LoanDiagnosticWriter;
};

export type CrearPrestamoIntegrante = {
  socio: string;
  tipoRelacion: "Titular";
};

export type CrearPrestamoInput = {
  cuotas: number;
  /**
   * ID de F.Module.Cuentas.Prestamos.DestinoPrestamo. Sin el, Vimarx deja el
   * de la linea (Consumo). Las refinanciaciones van con 61 (Refinanciacion),
   * como las cargan los analistas.
   */
  destino?: string;
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
  /**
   * Total de cancelaciones EN CENTAVOS, o undefined si la solicitud no tiene.
   * El legado no expone un campo para las cancelaciones: las toma de la
   * solicitud antigua, que un prestamo creado por API no tiene. NroLote es un
   * entero que el legado solo escribe desde sus importadores, asi que sirve de
   * portador y sobrevive a los recalculos del plan de cuotas. Con la novedad
   * CAN3RO de la linea apuntando a el, el legado arma el movimiento "Cancela
   * 3eros" y el asiento sale dividido. Por ser entero, va en centavos.
   */
  nroLote?: number;
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
  private readonly diagnostics: LoanDiagnosticWriter;

  constructor(config: CrearPrestamoGatewayConfig, fetcher: Fetcher = fetch) {
    this.baseUrl = config.baseUrl;
    this.fetcher = fetcher;
    this.timeoutMs = config.timeoutMs;
    this.diagnostics = config.diagnostics ?? (async () => undefined);
  }

  async crear(input: CrearPrestamoInput, context?: LoanDiagnosticContext): Promise<CrearPrestamoResult> {
    const diagnosticContext: LoanDiagnosticContext = context ?? { operationId: randomUUID(), operation: "loan_generation" };
    const callId = randomUUID();
    const startedAt = Date.now();
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
    const requestBody = JSON.stringify({
      campos: {
        FechaEmision: input.fechaEmision,
        Integrantes: input.integrantes.map((integrante) => ({
          Socio: integrante.socio,
          TipoRelacion: integrante.tipoRelacion,
        })),
        // Antes de LineaPrestamo: el legado evalua la novedad CAN3RO al
        // armar las cuotas, y eso puede dispararse al asignar la linea.
        NroLote: input.nroLote,
        LineaPrestamo: input.lineaPrestamo,
        Cuotas: input.cuotas,
        MontoDeseado: input.montoDeseado,
        Vendedor: input.vendedor,
        // Al final, como se probo en FapiTest (prestamo 441210).
        Destino: input.destino,
      },
      validar: false,
    });
    const headers = { "Content-Type": "application/json" };
    // A durable request trace is required before the irreversible remote call.
    await this.record(diagnosticContext, callId, startedAt, "REQUEST", {
      endpointPath: CREAR_PRESTAMO_PATH, url: new URL(CREAR_PRESTAMO_PATH, this.baseUrl).toString(),
      method: "POST", headers, body: requestBody,
    }, true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Awaited<ReturnType<Fetcher>> | undefined;
    let responseBody: string | null = null;
    let parsedBody: unknown;
    let bodyFormat: "text" | "json-fallback" = "text";
    let phase: "request" | "text" | "json" = "request";
    try {
      response = await abortable(this.fetcher(new URL(CREAR_PRESTAMO_PATH, this.baseUrl), {
        body: requestBody, headers, method: "POST", signal: controller.signal,
      }), controller.signal);
      if (response.text) {
        phase = "text";
        responseBody = await abortable(response.text(), controller.signal);
      } else {
        // Older injected gateways expose json() only. Production fetch always
        // uses text(), preserving whitespace and malformed responses exactly.
        phase = "json";
        bodyFormat = "json-fallback";
        parsedBody = await abortable(response.json(), controller.signal);
        responseBody = JSON.stringify(parsedBody) ?? null;
      }
    } catch (error) {
      clearTimeout(timeoutId);
      if (response) await this.recordResponse(diagnosticContext, callId, startedAt, response, responseBody, bodyFormat, error);
      await this.record(diagnosticContext, callId, startedAt, "FAILURE", {
        classification: controller.signal.aborted ? "timeout" : phase === "json" ? "invalid_json" : "network_error",
        error,
      });
      throw new PrestamoLegacyUnavailableError();
    } finally {
      // Keep the deadline active until the response body has been read too.
      clearTimeout(timeoutId);
    }
    await this.recordResponse(diagnosticContext, callId, startedAt, response, responseBody, bodyFormat);

    if (!response.ok) await this.record(diagnosticContext, callId, startedAt, "FAILURE", {
      classification: "http_error", error: new Error(`HTTP ${response.status ?? "unknown"} ${response.statusText ?? ""}`.trim()),
      status: response.status ?? null,
    });
    if (bodyFormat === "text") {
      try { parsedBody = JSON.parse(responseBody!); }
      catch (error) {
        if (response.ok) await this.record(diagnosticContext, callId, startedAt, "FAILURE", { classification: "invalid_json", error });
        throw new PrestamoLegacyUnavailableError();
      }
    }
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      if (response.ok) await this.record(diagnosticContext, callId, startedAt, "FAILURE", {
        classification: "invalid_response", error: new Error("Vimarx returned a non-object response."),
      });
      throw new PrestamoLegacyUnavailableError();
    }
    const row = parsedBody as Record<string, unknown>;
    const loanId = typeof row.ID === "string" || (typeof row.ID === "number" && Number.isSafeInteger(row.ID)) ? String(row.ID) : "";
    if (row.Ok === true && /^[1-9]\d*$/.test(loanId)) {
      // An explicit successful ID remains usable even if the HTTP status or a
      // subsequent diagnostic write failed; callers must not generate again.
      await this.record(diagnosticContext, callId, startedAt, "SUCCESS", { loanId, httpStatusOk: response.ok });
      return { id: loanId };
    }
    if (!response.ok) throw new PrestamoLegacyUnavailableError();
    if (row.Ok === false) {
      await this.record(diagnosticContext, callId, startedAt, "FAILURE", {
        classification: "rejection", error: new Error(typeof row.Error === "string" ? row.Error : "Vimarx rejected loan creation without a reason."),
      });
      throw new PrestamoLegacyRechazadoError("Vimarx rechazó la generación del préstamo. Un administrador debe revisar el diagnóstico de la operación.");
    }
    await this.record(diagnosticContext, callId, startedAt, "FAILURE", {
      classification: "invalid_response", error: new Error(row.Ok === true ? "Vimarx confirmed creation without a valid loan ID." : "Vimarx returned no explicit creation result."),
    });
    throw new PrestamoLegacyUnavailableError();
  }

  private async record(context: LoanDiagnosticContext, callId: string, startedAt: number, stage: string, data: unknown, required = false) {
    try {
      await this.diagnostics(context, { stage, callId, elapsedMs: Math.max(0, Date.now() - startedAt), data }, required);
    } catch {
      if (required) throw new PrestamoLegacyUnavailableError();
    }
  }

  private recordResponse(context: LoanDiagnosticContext, callId: string, startedAt: number, response: Awaited<ReturnType<Fetcher>>, body: string | null, bodyFormat: string, bodyReadError?: unknown) {
    const headers: Record<string, string> = {};
    response.headers?.forEach((value, key) => {
      headers[key] = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i.test(key) ? "[REDACTED]" : value;
    });
    return this.record(context, callId, startedAt, "RESPONSE", {
      endpointPath: CREAR_PRESTAMO_PATH, status: response.status ?? null,
      statusText: response.statusText ?? null, headers, body, bodyFormat,
      ...(bodyReadError === undefined ? {} : { bodyReadError }),
    });
  }
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Vimarx request deadline exceeded.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(value => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, error => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    if (signal.aborted) abort();
  });
}
