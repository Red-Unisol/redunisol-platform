import assert from "node:assert/strict";
import { it } from "node:test";
import {
  businessDate,
  canManageMonthlyCutoffs,
  firstDueDate,
  isAmejucaLine,
  MonthlyCutoffService,
  validateCutoffDate,
  validatePeriod,
  type CutoffRepository,
} from "./domain";
it("uses the confirmed day inclusively and never moves a reported weekend date", () => {
  assert.equal(firstDueDate("2026-11-08", "2026-11-08"), "2026-11-30");
  assert.equal(firstDueDate("2026-11-09", "2026-11-08"), "2026-12-31");
  assert.equal(firstDueDate("2026-12-09", "2026-12-08"), "2027-01-31");
  assert.equal(firstDueDate("2028-02-06", "2028-02-07"), "2028-02-29");
  assert.equal(firstDueDate("2028-02-08", "2028-02-07"), "2028-03-31");
});
it("rejects impossible dates, other periods and malformed period keys", () => {
  for (const date of [
    "2026-02-29",
    "2026-02-30",
    "2026-03-01",
    "2026-2-01",
    "bad",
  ])
    assert.throws(() => validateCutoffDate("2026-02", date));
  for (const period of ["2026-00", "2026-13", "2026-1", "2026-11/extra"])
    assert.throws(() => validatePeriod(period));
  assert.equal(validateCutoffDate("2028-02", "2028-02-29"), "2028-02-29");
});
it("uses Argentine civil dates at the UTC day boundary", () => {
  assert.equal(businessDate(new Date("2026-11-07T01:00:00Z")), "2026-11-06");
  assert.equal(businessDate(new Date("2026-11-07T04:00:00Z")), "2026-11-07");
});
it("limits the monthly override to the registered AMEJUCA line IDs and analyst capability", () => {
  assert.equal(isAmejucaLine("2519"), true);
  assert.equal(isAmejucaLine("2776"), true);
  assert.equal(isAmejucaLine("2670"), false);
  assert.equal(isAmejucaLine("AMEJUCA"), false);
  assert.equal(
    canManageMonthlyCutoffs({
      isSystemAdmin: false,
      workflowOwner: { code: "RIESGO", id: "r", name: "Riesgo" },
    }),
    true,
  );
  assert.equal(
    canManageMonthlyCutoffs({
      isSystemAdmin: false,
      workflowOwner: { code: "VENDEDORES", id: "v", name: "Vendedores" },
    }),
    false,
  );
  assert.equal(canManageMonthlyCutoffs({ isSystemAdmin: true }), true);
});
it("does not carry last month's date forward or query the calendar for other lines", async () => {
  const periods: string[] = [];
  const repository: CutoffRepository = {
    find: async (period) => {
      periods.push(period);
      return period === "2026-11"
        ? {
            period,
            cutoffDate: "2026-11-08",
            note: null,
            version: 1,
            updatedAt: "2026-11-01T12:00:00Z",
            updatedBy: "Analista",
          }
        : null;
    },
    history: async () => [],
    save: async () => {
      throw Error("not used");
    },
  };
  const service = new MonthlyCutoffService(repository, () => "2026-11-09");
  assert.equal((await service.resolve("2519"))?.firstDueDate, "2026-12-31");
  assert.equal(await service.resolve("2519", "2026-12-02"), null);
  assert.equal(await service.resolve("2670"), null);
  assert.deepEqual(periods, ["2026-11", "2026-12"]);
  assert.equal((await service.get("2026-12")).status, "estimated");
});
