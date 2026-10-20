import { ApiError } from "./api-error.ts";

const WITHOUT_REFRESH = new Set([
  "/auth/login",
  "/auth/refresh",
  "/auth/logout",
  "/auth/register",
  "/auth/verify-email",
  "/auth/resend-verification-code",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/me/change-password",
]);

/** One renewal per tab, with one bounded retry for temporary failures. */
export function createSessionFetch(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
) {
  let refreshing: Promise<Response> | null = null;

  async function refresh() {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetcher(new URL("/auth/refresh", baseUrl), {
          credentials: "include",
          method: "POST",
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status < 500) return response;
      } catch {
        // Connection errors and a lost response can be retried within the
        // server's recovery window. Business mutations are never retried here.
      }
      if (attempt === 0)
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new ApiError(
      "No pudimos renovar la sesión. Volvé a intentar en unos segundos.",
      503,
      undefined,
      undefined,
      "SESSION_UNAVAILABLE",
    );
  }

  return async function fetchWithSession(url: string, init: RequestInit) {
    const target = new URL(url, baseUrl);
    const response = await fetcher(target, { ...init, credentials: "include" });
    if (response.status !== 401 || WITHOUT_REFRESH.has(target.pathname)) {
      return response;
    }
    if (!refreshing) {
      refreshing = refresh().finally(() => {
        refreshing = null;
      });
    }
    const renewed = await refreshing;
    if (!renewed.ok) return renewed.clone();
    // An explicit 401 happens before the business handler runs. Only that
    // rejected request can be replayed, and never after its caller aborts.
    init.signal?.throwIfAborted();
    return fetcher(target, { ...init, credentials: "include" });
  };
}
