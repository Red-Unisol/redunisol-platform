import assert from "node:assert/strict";
import { it } from "node:test";
import { ApiError } from "./api-error.ts";
import { createSessionFetch } from "./session-fetch.ts";

const base = "https://api.example.test";

for (const failure of ["server", "connection"] as const) {
  it(`recovers a temporary ${failure} failure with one refresh retry`, async () => {
    let refreshes = 0;
    let operations = 0;
    const request = createSessionFetch(base, async (url) => {
      if (new URL(String(url)).pathname === "/auth/refresh") {
        if (++refreshes === 1) {
          if (failure === "connection") throw new TypeError("connection lost");
          return new Response(null, { status: 500 });
        }
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: ++operations === 1 ? 401 : 200 });
    });
    assert.equal(
      (await request("/solicitudes", { method: "GET" })).status,
      200,
    );
    assert.equal(refreshes, 2);
    assert.equal(operations, 2);
  });
}

it("propagates temporary renewal failure instead of returning the original 401", async () => {
  let operations = 0;
  let refreshes = 0;
  const request = createSessionFetch(base, async (url) => {
    if (new URL(String(url)).pathname === "/auth/refresh") {
      refreshes++;
      return new Response(null, { status: 503 });
    }
    operations++;
    return new Response(null, { status: 401 });
  });
  await assert.rejects(
    () => request("/auth/me", {}),
    (error) =>
      error instanceof ApiError &&
      error.status === 503 &&
      error.code === "SESSION_UNAVAILABLE",
  );
  assert.equal(refreshes, 2);
  assert.equal(operations, 1);
});

it("shares a single renewal among concurrent requests", async () => {
  let refreshes = 0;
  let valid = false;
  const request = createSessionFetch(base, async (url) => {
    if (new URL(String(url)).pathname === "/auth/refresh") {
      refreshes++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      valid = true;
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: valid ? 200 : 401 });
  });
  const responses = await Promise.all(
    ["/auth/me", "/solicitudes", "/api/socios"].map((path) =>
      request(path, {}),
    ),
  );
  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 200, 200],
  );
  assert.equal(refreshes, 1);
});

for (const status of [401, 403, 409]) {
  it(`preserves a definitive refresh response (${status}) without looping`, async () => {
    let calls = 0;
    const request = createSessionFetch(base, async (url) => {
      calls++;
      const refresh = new URL(String(url)).pathname === "/auth/refresh";
      return Response.json(
        { error: refresh ? "renewal denied" : "access expired" },
        { status: refresh ? status : 401 },
      );
    });
    const response = await request("/auth/me", {});
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: "renewal denied" });
    assert.equal(calls, 2);
  });
}

it("does not renew after a rejected login", async () => {
  let calls = 0;
  const request = createSessionFetch(base, async () => {
    calls++;
    return new Response(null, { status: 401 });
  });
  assert.equal((await request("/auth/login", { method: "POST" })).status, 401);
  assert.equal(calls, 1);
});

it("never retries a business mutation with an ambiguous server or network failure", async () => {
  for (const failure of ["server", "network"]) {
    let calls = 0;
    const request = createSessionFetch(base, async () => {
      calls++;
      if (failure === "network")
        throw new TypeError("connection lost after submission");
      return new Response(null, { status: 500 });
    });
    if (failure === "network")
      await assert.rejects(() => request("/solicitudes", { method: "POST" }));
    else
      assert.equal(
        (await request("/solicitudes", { method: "POST" })).status,
        500,
      );
    assert.equal(calls, 1);
  }
});

it("does not replay a caller's aborted mutation after refreshing", async () => {
  const controller = new AbortController();
  let operations = 0;
  const request = createSessionFetch(base, async (url) => {
    if (new URL(String(url)).pathname === "/auth/refresh") {
      controller.abort();
      return new Response(null, { status: 200 });
    }
    operations++;
    return new Response(null, { status: 401 });
  });
  await assert.rejects(
    () =>
      request("/solicitudes", { method: "POST", signal: controller.signal }),
    (error) => error instanceof DOMException && error.name === "AbortError",
  );
  assert.equal(operations, 1);
});

it("replays an explicitly unauthorized request only once", async () => {
  let operations = 0;
  let refreshes = 0;
  const request = createSessionFetch(base, async (url) => {
    if (new URL(String(url)).pathname === "/auth/refresh") {
      refreshes++;
      return new Response(null, { status: 200 });
    }
    operations++;
    return new Response(null, { status: 401 });
  });
  assert.equal((await request("/solicitudes", { method: "POST" })).status, 401);
  assert.equal(refreshes, 1);
  assert.equal(operations, 2);
});
