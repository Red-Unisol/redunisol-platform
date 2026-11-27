import assert from "node:assert/strict";
import test from "node:test";
import { LegacyFinancialGateway } from "./LegacyFinancialGateway";
import { IntegrationError } from "./domain";

test("queries loan financials and linked socio without a legacy request or CBU", async () => {
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
            ? [[101, 12, 0, 1000.01, null]]
            : [77, "20123456789"],
      };
    },
  );
  const loan = await gateway.loan("101", "77");
  assert.equal(loan.cmf, "0");
  assert.equal(loan.coinag, "1000.01");
  assert.equal(loan.cashInHand, "");
  assert.equal(loan.memberCuit, "20123456789");
  assert.equal(calls[0]?.tipo, "F.Module.Cuentas.Prestamos.Prestamo");
  assert.equal(
    calls[0]?.campos,
    "ID;LineaPrestamo.ID;[Bco CMF];[Bco Coinag Cba];[Monto En Mano]",
  );
  assert.match(calls[0]!.cmd, /Integrantes\[Socio.ID = 77\]/);
  assert.equal(calls[1]?.tipo, "F.Module.SocioMutual");
});

test("unexpected shape, wrong loan, unsafe criteria, HTTP and timeout fail closed", async () => {
  for (const body of [
    [],
    [[999, 12, 0, 1, -1]],
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

test("all financial columns still reject unsafe numeric amounts", async () => {
  for (const index of [2, 3, 4]) {
    const row = [101, 12, 0, 1000.01, 0];
    row[index] = 1_000_000_000_001;
    const gateway = new LegacyFinancialGateway(
      { baseUrl: "https://core.invalid", timeoutMs: 500 },
      async () => ({ ok: true, json: async () => row }),
    );
    await assert.rejects(
      gateway.loan("101", "77"),
      (error: unknown) =>
        error instanceof IntegrationError && error.code === "INVALID_AMOUNT",
    );
  }
});

test("Beex cancellations evaluate the active stored expression on the linked loan", async () => {
  const formula = "[Ejemplo de propiedad calculada]";
  const calls: { tipo: string; cmd: string; campos: string }[] = [];
  const results = [
    [101, 2705, 0, -4000000, null, 1],
    [284, formula],
    [101, 2705, 0, -4000000, -2410918.65, 158908135],
    [77, "20123456789"],
  ];
  const gateway = new LegacyFinancialGateway(
    { baseUrl: "https://core.invalid", timeoutMs: 500 },
    async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return { ok: true, json: async () => results.shift() };
    },
  );
  const loan = await gateway.loan("101", "77", true);
  assert.equal(loan.cashInHand, "-2410918.65");
  assert.equal(loan.cancellationCents, "158908135");
  assert.match(calls[1]!.cmd, /284.*Activo.*Monto En Mano Beex/);
  assert.match(calls[2]!.cmd, /Integrantes.*77.*2704,2705.*Solicitud/);
  assert.ok(calls[2]!.campos.endsWith(formula + ";NroLote"));
});

test("cancellations outside the Beex formula scope retain the legacy net", async () => {
  const results = [
    [101, 2705, 0, -1000, -850, 0],
    [77, "20123456789"],
  ];
  const gateway = new LegacyFinancialGateway(
    { baseUrl: "https://core.invalid", timeoutMs: 500 },
    async () => ({ ok: true, json: async () => results.shift() }),
  );
  const loan = await gateway.loan("101", "77", true);
  assert.equal(loan.cashInHand, "-850");
  assert.equal(loan.cancellationCents, undefined);
});
