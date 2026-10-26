import { SCENARIOS } from "./scenarios.ts";

/** Fixture-only transport. Production and mutation requests always fail closed. */
export const UI_LAB_API_ORIGIN = "http://beex-ui-lab.local";
export class UiLabNetworkBlockedError extends Error {
  constructor(method: string, path: string) {
    super(
      `UI Lab bloqueó ${method} ${path}: sólo se permiten fixtures locales.`,
    );
    this.name = "UiLabNetworkBlockedError";
  }
}
export function createUiLabFetch(): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input), UI_LAB_API_ORIGIN);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    (init?.signal ?? request?.signal)?.throwIfAborted();
    if (
      method !== "GET" ||
      url.origin !== UI_LAB_API_ORIGIN ||
      url.username ||
      url.password ||
      url.pathname !== "/fixtures/scenarios"
    )
      throw new UiLabNetworkBlockedError(method, url.pathname);
    return new Response(JSON.stringify(SCENARIOS), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  };
}
/** Install before importing components that could capture fetch. */
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
