import { INSTALLMENTS, SAMPLE_REQUEST } from "./scenarios.ts";
import {
  HEADER_DOCUMENT_REVIEW_FIXTURE,
  HEADER_SAMPLE,
  HEADER_SESSION_FIXTURE,
} from "./header-fixtures.ts";

/** Fixture-only transport for the UI lab. No request ever reaches a real API. */
export const UI_LAB_API_ORIGIN = "http://beex-ui-lab.local";
export const UI_LAB_SOLICITUD_ID = SAMPLE_REQUEST.id;

export class UiLabNetworkBlockedError extends Error {
  constructor(method: string, path: string) {
    super(
      `UI Lab bloqueó ${method} ${path}: sólo se permiten fixtures GET locales.`,
    );
    this.name = "UiLabNetworkBlockedError";
  }
}

const isoDate = (date: string) => date.split("/").reverse().join("-");
const revisionFixture = {
  titular: {
    nombreCompleto: SAMPLE_REQUEST.name,
    nroSocio: SAMPLE_REQUEST.member,
  },
  convenio: null,
  condiciones: {
    lineaDescripcion: SAMPLE_REQUEST.line,
    montoAFinanciar: SAMPLE_REQUEST.amount,
    cuotas: SAMPLE_REQUEST.cuotas,
  },
  calculo: {
    capital: SAMPLE_REQUEST.capital,
    cuotaResultante: SAMPLE_REQUEST.installment,
    cuotas: SAMPLE_REQUEST.cuotas,
    gastos: SAMPLE_REQUEST.expenses,
    tasa: null,
    total: SAMPLE_REQUEST.total,
    fechaPrimerVencimiento: isoDate(SAMPLE_REQUEST.firstDue),
    fechaUltimaCuota: isoDate(INSTALLMENTS.at(-1)!.date),
    cuotasDetalle: INSTALLMENTS.map((installment) => ({
      capital: null,
      gastos: null,
      interes: null,
      numeroCuota: installment.number,
      total: installment.amount,
      fechaVencimiento: isoDate(installment.date),
    })),
  },
};

export function createUiLabFetch(): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input), UI_LAB_API_ORIGIN);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const signal = init?.signal ?? request?.signal;
    signal?.throwIfAborted();
    if (
      method !== "GET" ||
      url.origin !== UI_LAB_API_ORIGIN ||
      url.username ||
      url.password
    )
      throw new UiLabNetworkBlockedError(method, url.pathname);
    const base = `/solicitudes/${UI_LAB_SOLICITUD_ID}`;
    let body: unknown;
    if (url.pathname === `${base}/revision-prestamo`) body = revisionFixture;
    else if (url.pathname === `${base}/cancelaciones`) body = [];
    else if (url.pathname === "/auth/me") body = HEADER_SESSION_FIXTURE;
    else if (url.pathname === `${base}/datos-rapidos/socio`)
      body = { condicion: "member" };
    else if (url.pathname === `${base}/datos-rapidos/convenio`)
      body = { descripcion: HEADER_SAMPLE.convenio };
    else if (url.pathname === `${base}/datos-rapidos/mora`)
      body = { enMora: false };
    else if (url.pathname === `${base}/datos-rapidos/creditos`)
      body = { activos: true };
    else if (url.pathname === `${base}/document-review`)
      body = HEADER_DOCUMENT_REVIEW_FIXTURE;
    else throw new UiLabNetworkBlockedError(method, url.pathname);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  };
}

/** Install before importing any production component that may capture fetch. */
export function installUiLabNetworkGuard(
  target: { fetch: typeof fetch } = globalThis,
): () => void {
  const previous = target.fetch;
  const fixtureFetch = createUiLabFetch();
  target.fetch = fixtureFetch;
  return () => {
    if (target.fetch === fixtureFetch) target.fetch = previous;
  };
}
