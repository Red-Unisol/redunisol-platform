import assert from "node:assert/strict";
import test from "node:test";
import { LegacyFinancialGateway } from "./LegacyFinancialGateway";
import { IntegrationError } from "./domain";

test("queries loan and linked socio directly; never PreSolicitud", async () => {
  const calls: { tipo: string; cmd: string; campos: string }[] = [];
  const gateway = new LegacyFinancialGateway(
    { baseUrl: "https://core.invalid", timeoutMs: 500 },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as (typeof calls)[number];
      calls.push(body);
      return {
        ok: true,
        json: async () =>
          calls.length === 1
            ? [[101, 12, "0000000000000000000001", 0, 1000.01, -1000.01]]
            : [77, "20123456789"],
      };
    },
  );
  const loan = await gateway.loan("101", "77");
  assert.equal(loan.coinag, "1000.01");
  assert.equal(loan.memberCuit, "20123456789");
  assert.equal(calls[0]?.tipo, "F.Module.Cuentas.Prestamos.Prestamo");
  assert.match(calls[0]!.cmd, /Integrantes\[Socio.ID = 77\]/);
  assert.equal(calls[1]?.tipo, "F.Module.SocioMutual");
});

test("unexpected shape, wrong loan, unsafe criteria, HTTP and timeout fail closed", async () => {
  for (const body of [
    [],
    [[999, 12, "", 0, 1, -1]],
    { error: "wrong property" },
    [[101], [101]],
  ]) {
    const gateway = new LegacyFinancialGateway(
      { baseUrl: "https://core.invalid", timeoutMs: 500 },
      async () => ({ ok: true, json: async () => body }),
    );
    await assert.rejects(gateway.loan("101", "77"), IntegrationError);
  }
  let fetched = false;
  const gateway = new LegacyFinancialGateway(
    { baseUrl: "https://core.invalid", timeoutMs: 500 },
    async () => {
      fetched = true;
      throw new Error("timeout");
    },
  );
  await assert.rejects(gateway.loan("1 Or 1=1", "77"), IntegrationError);
  assert.equal(fetched, false);
  await assert.rejects(
    gateway.loan("101", "77"),
    (e: unknown) => e instanceof IntegrationError && e.statusCode === 503,
  );
});
