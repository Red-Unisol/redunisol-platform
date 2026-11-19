import { USERS_FIXTURE, USERS_WORKFLOW_OWNERS } from "./users-fixtures.ts";
import { INSTALLMENTS, SAMPLE_REQUEST } from "./header-sample.ts";
import { SCENARIOS } from "./scenarios.ts";
import { externalLegajoFixture } from "./external-legajo-fixtures.ts";
import { habitualCbuFixture } from "./cbu-fixtures.ts";
import { createReliquidationFixture, type ReliquidationScenario } from "./reliquidacion-fixtures.ts";
import { createGenerationFixture } from "./loan-generation-fixtures.ts";
import {
  HEADER_DOCUMENT_REVIEW_FIXTURE,
  HEADER_SAMPLE,
  HEADER_SESSION_FIXTURE,
} from "./header-fixtures.ts";
import {
  productionFixture,
  type ProductionFixtureOptions,
} from "./production-fixtures.ts";

type UiLabFixtureOptions = { production?: ProductionFixtureOptions; externalLegajo?: "waiting" | "approved" | "error"; reliquidation?: ReliquidationScenario; loanGeneration?: string };

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

export function createUiLabFetch(
  options: UiLabFixtureOptions = {},
): typeof fetch {
  let externalApproved = options.externalLegajo === "approved";
  let cbuAttempts = 0;
  const demoUsers = options.production?.role === "admin" && options.production.editAreas
    ? structuredClone(USERS_FIXTURE) : null;
  const reliquidation = options.reliquidation ? createReliquidationFixture(options.reliquidation, UI_LAB_SOLICITUD_ID) : null;
  const generation = options.loanGeneration ? createGenerationFixture(options.loanGeneration, UI_LAB_SOLICITUD_ID) : null;
  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input), UI_LAB_API_ORIGIN);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const signal = init?.signal ?? request?.signal;
    signal?.throwIfAborted();
    if (demoUsers && url.origin === UI_LAB_API_ORIGIN && !url.username && !url.password) {
      if (method === "GET" && url.pathname === "/auth/users/pending-area") {
        return Response.json({ users: demoUsers.filter((user) => user.state === 2) });
      }
      if (method === "GET" && url.pathname === "/auth/users") return Response.json({ users: demoUsers });
      const user = demoUsers.find((user) => url.pathname === `/auth/users/${user.id}/workflow-owners`);
      if (user && method === "PATCH") {
        const { workflowOwnerIds } = JSON.parse(String(init?.body));
        const removed = user.workflowOwners?.find((area) => !workflowOwnerIds.includes(area.id));
        user.workflowOwners = USERS_WORKFLOW_OWNERS.filter((area) => workflowOwnerIds.includes(area.id));
        user.workflowOwnerId = user.workflowOwners[0]?.id ?? null;
        if (user.state !== 0) user.state = user.workflowOwners.length ? 1 : 2;
        return Response.json({ user, pendingAssignments: removed ? [{
          id: HEADER_SAMPLE.id, nroSolicitud: HEADER_SAMPLE.number, areaCode: removed.code,
          areaName: removed.name, stateName: "Solicitada",
        }] : [] });
      }
    }
    if (generation && url.origin === UI_LAB_API_ORIGIN && !url.username && !url.password) {
      const result = await generation(method, url.pathname, init?.body);
      if (result) return result;
    }
    if (reliquidation && url.origin === UI_LAB_API_ORIGIN && !url.username && !url.password) {
      const result = await reliquidation(method, url.pathname, init?.body);
      if (result) return result;
    }
    if (options.externalLegajo && url.origin === UI_LAB_API_ORIGIN && !url.username && !url.password &&
      method === "POST" && url.pathname === `/solicitudes/${UI_LAB_SOLICITUD_ID}/document-review/external`) {
      if (options.externalLegajo !== "error") externalApproved = true;
      return new Response(JSON.stringify(options.externalLegajo === "error"
        ? { error: { message: "No se pudo guardar el legajo externo. Podés reintentar la carga." } }
        : externalLegajoFixture(true)), { status: options.externalLegajo === "error" ? 503 : 200,
        headers: { "Content-Type": "application/json" } });
    }
    if (
      method !== "GET" ||
      url.origin !== UI_LAB_API_ORIGIN ||
      url.username ||
      url.password
    )
      throw new UiLabNetworkBlockedError(method, url.pathname);
    const base = `/solicitudes/${UI_LAB_SOLICITUD_ID}`;
    const production = options.production
      ? productionFixture(url.pathname, options.production)
      : { found: false as const };
    let body: unknown;
    if (production.found) body = production.body;
    else if (url.pathname === "/fixtures/scenarios") body = SCENARIOS;
    else if (url.pathname === "/api/notifications")
      body = { items: [], unreadCount: 0, total: 0, offset: 0, limit: 8 };
    else if (url.pathname === `${base}/revision-prestamo`)
      body = revisionFixture;
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
    else if (url.pathname === `${base}/datos-rapidos/cbu`)
      body = habitualCbuFixture(options.production?.cbuScenario, ++cbuAttempts);
    else if (url.pathname === `${base}/document-review`)
      body = options.externalLegajo ? externalLegajoFixture(externalApproved) : HEADER_DOCUMENT_REVIEW_FIXTURE;
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
  options: UiLabFixtureOptions = {},
): () => void {
  const previous = target.fetch;
  const fixtureFetch = createUiLabFetch(options);
  target.fetch = fixtureFetch;
  return () => {
    if (target.fetch === fixtureFetch) target.fetch = previous;
  };
}
