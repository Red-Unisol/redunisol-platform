import assert from "node:assert/strict";
import { it } from "node:test";
import {
  createUiLabFetch,
  installUiLabNetworkGuard,
  UiLabNetworkBlockedError,
  UI_LAB_API_ORIGIN,
} from "./network-guard.ts";

it("serves only isolated fixtures and never invokes the original transport", async () => {
  let realCalls = 0;
  const original = (async () => {
    realCalls++;
    throw new Error("Real network must never run");
  }) as typeof fetch;
  const target = { fetch: original };
  const restore = installUiLabNetworkGuard(target);
  const result = await (
    await target.fetch(`${UI_LAB_API_ORIGIN}/fixtures/scenarios`)
  ).json();
  assert.ok(result.some((row: { id: string }) => row.id === "requested"));
  result[0].signature.approved = true;
  const again = await (
    await target.fetch(`${UI_LAB_API_ORIGIN}/fixtures/scenarios`)
  ).json();
  assert.equal(again[0].signature.approved, false);
  assert.equal(realCalls, 0);
  restore();
  assert.equal(target.fetch, original);
});

it("blocks mutations, real APIs, credentials and unknown routes without fallback", async () => {
  const fetcher = createUiLabFetch();
  for (const method of ["POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"])
    await assert.rejects(
      () => fetcher(`${UI_LAB_API_ORIGIN}/fixtures/scenarios`, { method }),
      UiLabNetworkBlockedError,
    );
  for (const url of [
    `${UI_LAB_API_ORIGIN}/solicitudes/demo/prestamo`,
    `${UI_LAB_API_ORIGIN}/api/notifications`,
    "https://api-solicitudes.redunisol.com.ar/solicitudes",
    "http://127.0.0.1:5272/solicitudes",
    "http://beex-ui-lab.local.evil.invalid/fixtures/scenarios",
    "http://name@beex-ui-lab.local/fixtures/scenarios",
  ])
    await assert.rejects(() => fetcher(url), UiLabNetworkBlockedError);
  await assert.rejects(
    () =>
      fetcher(
        new Request(`${UI_LAB_API_ORIGIN}/fixtures/scenarios`, {
          method: "POST",
        }),
      ),
    UiLabNetworkBlockedError,
  );
});

it("respects aborted requests", async () => {
  const controller = new AbortController();
  controller.abort(new Error("aborted fixture"));
  await assert.rejects(
    () =>
      createUiLabFetch()(`${UI_LAB_API_ORIGIN}/fixtures/scenarios`, {
        signal: controller.signal,
      }),
    /aborted fixture/,
  );
});
