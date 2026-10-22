import assert from "node:assert/strict";
import test from "node:test";
import { externalPaymentToday } from "./external-payment-form.ts";

test("payment date defaults to the current day in Argentina", () => {
  assert.equal(
    externalPaymentToday(new Date("2026-10-23T01:00:00Z")),
    "2026-10-22",
  );
  assert.equal(
    externalPaymentToday(new Date("2026-10-23T04:00:00Z")),
    "2026-10-23",
  );
});
