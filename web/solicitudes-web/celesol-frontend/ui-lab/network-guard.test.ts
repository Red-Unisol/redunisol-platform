import assert from "node:assert/strict";
import { it } from "node:test";
import { SAMPLE_REQUEST } from "./header-sample.ts";
import { HEADER_SAMPLE } from "./header-fixtures.ts";
import {
  createUiLabFetch,
  installUiLabNetworkGuard,
  UiLabNetworkBlockedError,
  UI_LAB_API_ORIGIN,
  UI_LAB_SOLICITUD_ID,
} from "./network-guard.ts";
const route = `/solicitudes/${UI_LAB_SOLICITUD_ID}`;

it("serves explicit real-page read fixtures with role controls while rejecting writes and unknown IDs", async () => {
  const fetcher = createUiLabFetch({ production: { role: "vendedor" } });
  const get = async (pathname: string) =>
    (await fetcher(`${UI_LAB_API_ORIGIN}${pathname}`)).json();
  assert.equal((await get("/auth/me")).user.workflowOwner.code, "VENDEDORES");
  const detail = await get(route);
  assert.equal(detail.titular.nroDocumento, HEADER_SAMPLE.document);
  assert.equal(detail.capabilities.canEdit, false);
  assert.equal(detail.capabilities.canChangeState, false);
  for (const pathname of [
    "/api/notifications",
    "/solicitudes/tipos-adjunto",
    `${route}/adjuntos`,
    `${route}/history`,
    `${route}/lineas-prestamo`,
    `${route}/linked-loan-status`,
    `${route}/admin-loan-replacements`,
    `${route}/admin-state-correction`,
    `${route}/pago-externo`,
    `${route}/credixsa`,
  ]) {
    assert.equal(
      (await fetcher(`${UI_LAB_API_ORIGIN}${pathname}`)).status,
      200,
    );
    await assert.rejects(
      () => fetcher(`${UI_LAB_API_ORIGIN}${pathname}`, { method: "POST" }),
      UiLabNetworkBlockedError,
    );
  }
  const saved = await get(
    `/api/riesgo/calculadora/core/${UI_LAB_SOLICITUD_ID}/evaluacion`,
  );
  assert.ok(
    Object.values(saved.evaluacion.snapshot.sheets).some(
      (sheet: unknown) => (sheet as { name: string }).name === "Datos",
    ),
  );
  await assert.rejects(
    () => fetcher(`${UI_LAB_API_ORIGIN}/solicitudes/another-id`),
    UiLabNetworkBlockedError,
  );
  await assert.rejects(
    () => createUiLabFetch()(`${UI_LAB_API_ORIGIN}${route}`),
    UiLabNetworkBlockedError,
  );
});

it("serves the current signature workflow scenarios without a network fallback", async () => {
  let realCalls = 0;
  const target = {
    fetch: (async () => {
      realCalls++;
      throw new Error("Unexpected real network");
    }) as typeof fetch,
  };
  const restore = installUiLabNetworkGuard(target);
  const first = await (
    await target.fetch(`${UI_LAB_API_ORIGIN}/fixtures/scenarios`)
  ).json();
  assert.ok(first.some((row: { id: string }) => row.id === "requested"));
  first[0].signature.approved = true;
  const second = await (
    await target.fetch(`${UI_LAB_API_ORIGIN}/fixtures/scenarios`)
  ).json();
  assert.equal(second[0].signature.approved, false);
  for (const method of ["POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"]) {
    await assert.rejects(
      () => target.fetch(`${UI_LAB_API_ORIGIN}/fixtures/scenarios`, { method }),
      UiLabNetworkBlockedError,
    );
  }
  assert.equal(realCalls, 0);
  restore();
});

it("serves deterministic GET fixtures without invoking the original transport", async () => {
  let realCalls = 0;
  const target = {
    fetch: (async () => {
      realCalls++;
      throw new Error("Real network must never run");
    }) as typeof fetch,
  };
  const restore = installUiLabNetworkGuard(target);
  const response = await target.fetch(
    `${UI_LAB_API_ORIGIN}${route}/revision-prestamo`,
  );
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.condiciones.montoAFinanciar, SAMPLE_REQUEST.amount);
  assert.equal(result.condiciones.cuotas, SAMPLE_REQUEST.cuotas);
  assert.equal(result.calculo.cuotaResultante, SAMPLE_REQUEST.installment);
  assert.equal(result.titular.nombreCompleto, SAMPLE_REQUEST.name);
  assert.equal(result.calculo.capital, SAMPLE_REQUEST.capital);
  assert.equal(result.calculo.gastos, SAMPLE_REQUEST.expenses);
  assert.equal(result.calculo.total, SAMPLE_REQUEST.total);
  assert.equal(result.calculo.cuotasDetalle.length, SAMPLE_REQUEST.cuotas);
  const scheduledTotal = result.calculo.cuotasDetalle.reduce(
    (sum: number, cuota: { total: number }) => sum + cuota.total,
    0,
  );
  assert.equal(
    Math.round(scheduledTotal * 100),
    Math.round(result.calculo.total * 100),
  );
  assert.deepEqual(
    await (
      await target.fetch(`${UI_LAB_API_ORIGIN}${route}/cancelaciones`)
    ).json(),
    [],
  );
  result.condiciones.montoAFinanciar = 1;
  assert.equal(
    (
      await (
        await target.fetch(`${UI_LAB_API_ORIGIN}${route}/revision-prestamo`)
      ).json()
    ).condiciones.montoAFinanciar,
    600000,
  );
  assert.equal(realCalls, 0);
  restore();
});

it("serves the fictional session, applicant and review contracts used by real header components", async () => {
  const fetcher = createUiLabFetch();
  const get = async (path: string) =>
    (await fetcher(`${UI_LAB_API_ORIGIN}${path}`)).json();
  const session = await get("/auth/me");
  assert.equal(session.user.firstName, "SOFÍA");
  assert.equal(session.user.lastName, "DEMO");
  assert.equal(session.user.isSystemAdmin, false);
  assert.deepEqual(await get(`${route}/datos-rapidos/socio`), {
    condicion: "member",
  });
  assert.deepEqual(await get(`${route}/datos-rapidos/convenio`), {
    descripcion: HEADER_SAMPLE.convenio,
  });
  assert.deepEqual(await get(`${route}/datos-rapidos/mora`), {
    enMora: false,
  });
  assert.deepEqual(await get(`${route}/datos-rapidos/creditos`), {
    activos: true,
  });
  const review = await get(`${route}/document-review`);
  assert.equal(review.canDecide, false);
  assert.equal(review.state, "Pagada");
  assert.equal(review.currentReview.systemDecision, "approve");
  assert.ok(review.history.length > 0);
  const attempt = review.currentReview.attempts.find(
    (item: { verificationId: string }) =>
      item.verificationId === review.currentReview.selectedVerificationId,
  );
  assert.ok(attempt);
  assert.ok(attempt.checks.length > 0);
  assert.equal(
    attempt.checks.every((check: { passed: boolean }) => check.passed),
    true,
  );
  assert.equal(attempt.dashboardUrl, null);
  assert.equal(review.currentReview.legajoAdjuntoId, null);
  assert.equal(review.history[0].decisions[0].humanDecision, "approve");
  // Responses remain independent after a consumer mutates its parsed copy.
  review.currentReview.attempts[0].checks[0].passed = false;
  const next = await get(`${route}/document-review`);
  assert.equal(next.currentReview.attempts[0].checks[0].passed, true);
});

it("does not grant mutations or new routes when header GET fixtures are available", async () => {
  const fetcher = createUiLabFetch();
  for (const path of [
    "/auth/me",
    `${route}/datos-rapidos/socio`,
    `${route}/datos-rapidos/convenio`,
    `${route}/datos-rapidos/mora`,
    `${route}/datos-rapidos/creditos`,
    `${route}/document-review`,
    `${route}/document-review/evaluate`,
    `${route}/document-review/decisions`,
  ])
    await assert.rejects(
      () => fetcher(`${UI_LAB_API_ORIGIN}${path}`, { method: "POST" }),
      UiLabNetworkBlockedError,
    );
  for (const path of [
    "/solicitudes/another-request/datos-rapidos/socio",
    "/solicitudes/another-request/document-review",
    `${route}/datos-rapidos/unknown`,
    `${route}/document-review/evaluate`,
    `${route}/document-review/decisions`,
    `${route}/document-review/demo-revision-001/legajo`,
  ])
    await assert.rejects(
      () => fetcher(`${UI_LAB_API_ORIGIN}${path}`),
      UiLabNetworkBlockedError,
    );
});

it("fails closed for mutations, unknown routes and production or external hosts", async () => {
  let realCalls = 0;
  const target = {
    fetch: (async () => {
      realCalls++;
      throw new Error("Real network must never run");
    }) as typeof fetch,
  };
  installUiLabNetworkGuard(target);
  for (const method of ["POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"])
    await assert.rejects(
      () =>
        target.fetch(`${UI_LAB_API_ORIGIN}${route}/revision-prestamo`, {
          method,
        }),
      UiLabNetworkBlockedError,
    );
  for (const url of [
    `${UI_LAB_API_ORIGIN}/auth/refresh`,
    `${UI_LAB_API_ORIGIN}/unknown`,
    `https://api-solicitudes.redunisol.com.ar${route}/revision-prestamo`,
    `https://redunisol.com.ar/`,
    `http://127.0.0.1:5272${route}/revision-prestamo`,
    `http://beex-ui-lab.local.evil.invalid${route}/revision-prestamo`,
    `http://name@beex-ui-lab.local${route}/revision-prestamo`,
  ])
    await assert.rejects(() => target.fetch(url), UiLabNetworkBlockedError);
  await assert.rejects(
    () =>
      target.fetch(
        new Request(`${UI_LAB_API_ORIGIN}${route}/cancelaciones`, {
          method: "POST",
        }),
      ),
    UiLabNetworkBlockedError,
  );
  assert.equal(realCalls, 0);
});

it("respects aborted signals without a network fallback", async () => {
  const fetcher = createUiLabFetch();
  const controller = new AbortController();
  controller.abort(new Error("aborted fixture"));
  await assert.rejects(
    () =>
      fetcher(`${UI_LAB_API_ORIGIN}${route}/cancelaciones`, {
        signal: controller.signal,
      }),
    /aborted fixture/,
  );
});
