import assert from "node:assert/strict";
import test from "node:test";
import { PadronesGateway, padronesDocument } from "./PadronesGateway";

const config = {
  url: "https://tools.example.invalid/api/internal/padrones/lookup",
  token: "test-only-token-that-is-at-least-32-characters",
};
const report = {
  document: "12345678",
  queried_at: "2026-11-11T12:00:00Z",
  sources: [
    {
      id: "educacion",
      name: "Educación",
      kind: "padron",
      status: "ready",
      period: "2026-11",
      loaded_at: "2026-11-11T12:00:00Z",
      matches: [
        { row: 2, data: { Nombre: "Persona ficticia", Neto: "1000" } },
        { row: 3, data: { Nombre: "Segundo cargo" } },
      ],
    },
  ],
};

test("DNI/CUIL normalization matches the source without accepting arbitrary text", () => {
  assert.equal(padronesDocument("20-12345678-3"), "12345678");
  assert.equal(padronesDocument("12.345.678"), "12345678");
  assert.equal(padronesDocument("0123456"), "123456");
  for (const input of ["x12345678", "1e7", "123", "00000000", null])
    assert.equal(padronesDocument(input), null);
});

test("lookup sends the credential only to the configured HTTPS endpoint and preserves all matches", async () => {
  const gateway = new PadronesGateway(config, async (url, init) => {
    assert.equal(url, config.url);
    assert.equal(init?.redirect, "error");
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      `Bearer ${config.token}`,
    );
    assert.deepEqual(JSON.parse(String(init?.body)), { document: "12345678" });
    return Response.json(report);
  });
  assert.deepEqual(await gateway.lookup("12345678"), report);
});

test("invalid configuration cannot issue a request", async () => {
  for (const change of [
    { url: "http://tools.invalid/lookup" },
    { url: "https://tools.invalid/lookup?token=secret" },
    { url: "https://user:secret@tools.invalid/lookup" },
    { token: "" },
  ]) {
    const gateway = new PadronesGateway({ ...config, ...change }, async () =>
      assert.fail("No request expected"),
    );
    assert.equal(gateway.configured(), false);
    await assert.rejects(gateway.lookup("12345678"));
  }
});

test("provider errors, different identities, malformed reports and oversized bodies fail closed", async () => {
  for (const body of [
    { ...report, document: "87654321" },
    { ...report, sources: null },
    { ...report, sources: [{ ...report.sources[0], status: "needs_review" }] },
  ]) {
    await assert.rejects(
      new PadronesGateway(config, async () => Response.json(body)).lookup(
        "12345678",
      ),
    );
  }
  await assert.rejects(
    new PadronesGateway(
      config,
      async () => new Response("unavailable", { status: 503 }),
    ).lookup("12345678"),
  );
  await assert.rejects(
    new PadronesGateway(
      config,
      async () => new Response(" ".repeat(2 * 1024 * 1024 + 1)),
    ).lookup("12345678"),
  );
});
