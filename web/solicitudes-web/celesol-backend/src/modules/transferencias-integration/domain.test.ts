import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  buildPlan,
  money,
  IntegrationError,
  type PlanSource,
  type LoanFinancials,
} from "./domain";

const memberCuit = "20123456789";
const memberCbu = "0000000000000000000001";
function fixture() {
  const source: PlanSource = {
    id: randomUUID(),
    nroSolicitud: "S-TEST",
    legacyOid: "101",
    montoAFinanciar: new Prisma.Decimal("1000.01"),
    firmaDigitalmente: true,
    titular: {
      cbu: memberCbu,
      cbuNoHabitual: null,
      cuit: memberCuit,
      nroDocumento: "12345678",
      nombre: "Prueba",
      apellidoDenominacion: "Test",
    },
    cancelaciones: [],
  };
  const loan: LoanFinancials = {
    loanId: "101",
    lineId: "12",
    cbu: memberCbu,
    cmf: "0",
    coinag: "1000.01",
    cashInHand: "-1000.01",
    memberCuit,
  };
  return { source, loan };
}
const code = (expected: string) => (error: unknown) =>
  error instanceof IntegrationError && error.code === expected;

test("exact money rejects rounding, localization and scientific notation", () => {
  assert.equal(money("9999999999999999.99").toFixed(2), "9999999999999999.99");
  for (const value of ["1.001", "1,01", "NaN", "1e10", "10000000000000000"])
    assert.throws(() => money(value), code("INVALID_AMOUNT"));
});

test("member plan distinguishes UUID, loan ID and financial line ID", () => {
  const { source, loan } = fixture();
  const plan = buildPlan(source, loan, new Map());
  assert.equal(plan.source, "BEEX");
  assert.equal(plan.solicitudId, source.id);
  assert.equal(plan.prestamoLegacyId, "101");
  assert.equal(plan.financialLineId, "12");
  assert.equal(plan.payments[0]?.amount, "1000.01");
  assert.equal(plan.verification.requestNumber, "101");
  assert.equal(plan.verification.required, true);
  assert.equal(plan.version, buildPlan(source, loan, new Map()).version);
});

test("cancellations reconcile exactly, keep UUID keys and allow zero member net", () => {
  const { source, loan } = fixture();
  const id = randomUUID();
  source.cancelaciones = [
    {
      id,
      socio: "Acreedor de prueba",
      socioLegacyId: "45",
      cbu: "0000000000000000000002",
      monto: new Prisma.Decimal("600.01"),
    },
  ];
  loan.cashInHand = "-400";
  const creditors = new Map([[id, "30123456789"]]);
  const plan = buildPlan(source, loan, creditors);
  assert.deepEqual(
    plan.payments.map((p) => p.amount),
    ["400.00", "600.01"],
  );
  assert.equal(plan.payments[1]?.paymentKey, `creditor:${id}`);
  loan.cashInHand = "400.01";
  assert.throws(
    () => buildPlan(source, loan, creditors),
    code("TOTAL_MISMATCH"),
  );
  loan.cashInHand = "0";
  source.cancelaciones[0]!.monto = new Prisma.Decimal("1000.01");
  assert.equal(buildPlan(source, loan, creditors).payments.length, 1);
  creditors.set(id, memberCuit);
  assert.throws(
    () => buildPlan(source, loan, creditors),
    code("INVALID_CREDITOR"),
  );
});

test("ambiguous bank source, loan/member/account mismatch and missing creditor block", () => {
  for (const mutate of [
    (loan: LoanFinancials) => {
      loan.loanId = "999";
    },
    (loan: LoanFinancials) => {
      loan.memberCuit = "20111111111";
    },
    (loan: LoanFinancials) => {
      loan.cbu = "0000000000000000000009";
    },
    (loan: LoanFinancials) => {
      loan.cmf = "1";
    },
  ]) {
    const { source, loan } = fixture();
    mutate(loan);
    assert.throws(() => buildPlan(source, loan, new Map()), IntegrationError);
  }
});

test("non habitual CBU overrides usual CBU; renewal is explicit and changes version", () => {
  const { source, loan } = fixture();
  const old = buildPlan(source, loan, new Map());
  source.titular!.cbuNoHabitual = "0000000000000000000002";
  loan.cbu = source.titular!.cbuNoHabitual;
  loan.coinag = "800";
  const plan = buildPlan(source, loan, new Map());
  assert.equal(plan.requiresRenewalReview, true);
  assert.equal(plan.payments[0]?.cbu, loan.cbu);
  assert.notEqual(plan.version, old.version);
});
