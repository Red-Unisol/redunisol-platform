import assert from "node:assert/strict";
import { it } from "node:test";
import { SAMPLE_REQUEST } from "./scenarios.ts";
import {
  createUiLabFetch,
  installUiLabNetworkGuard,
  UiLabNetworkBlockedError,
  UI_LAB_API_ORIGIN,
  UI_LAB_SOLICITUD_ID,
} from "./network-guard.ts";
const route = `/solicitudes/${UI_LAB_SOLICITUD_ID}`;

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
