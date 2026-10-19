import assert from "node:assert/strict";
import { it } from "node:test";
import { formatLegacyDate } from "./legacy-date-format";

it("keeps the birthday entered in Beex when the API returns UTC midnight", () => {
  assert.equal(formatLegacyDate("1990-01-01T00:00:00.000Z"), "01/01/1990");
});

it("keeps the first installment date shown in the loan preview", () => {
  assert.equal(formatLegacyDate("2026-11-30T00:00:00.000Z"), "30/11/2026");
  assert.equal(formatLegacyDate("2026-11-30"), "30/11/2026");
});

it("preserves leap days and the placeholder for absent calendar dates", () => {
  assert.equal(formatLegacyDate("2024-02-29T00:00:00"), "29/02/2024");
  for (const missing of [null, undefined, ""]) assert.equal(formatLegacyDate(missing), "-");
});