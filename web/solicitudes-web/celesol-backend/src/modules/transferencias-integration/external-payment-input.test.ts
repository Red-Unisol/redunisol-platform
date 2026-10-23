import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { externalPaymentInput } from "./external-payment-input";
import { argentinaToday, receiptFormat } from "./ExternalPaymentService";

test("external payment permits omitted reference and comment and validates real calendar dates", () => {
  const input = {
    requestId: randomUUID(),
    paidOn: "2026-10-20",
    reference: "  BANK-123  ",
  };
  assert.deepEqual(externalPaymentInput.parse(input), {
    ...input,
    reference: "BANK-123",
    comment: "",
  });
  assert.equal(
    externalPaymentInput.safeParse({ ...input, paidOn: "2026-02-30" }).success,
    false,
  );
  for (const reference of [undefined, "", "   "]) {
    assert.deepEqual(externalPaymentInput.parse({ ...input, reference }), {
      ...input, reference: "", comment: "",
    });
  }
  assert.equal(externalPaymentInput.safeParse({ ...input, reference: "x".repeat(201) }).success, false);
  assert.equal(
    externalPaymentInput.safeParse({ ...input, amount: "1.00" }).success,
    false,
  );
});

test("today uses Argentina even across the UTC day boundary", () => {
  assert.equal(argentinaToday(new Date("2026-10-23T01:30:00Z")), "2026-10-22");
  assert.equal(argentinaToday(new Date("2026-10-23T03:30:00Z")), "2026-10-23");
});

test("receipt type comes from the bytes and rejects arbitrary or truncated PDFs", () => {
  assert.equal(
    receiptFormat(Buffer.from("%PDF-1.7\nreceipt\n%%EOF")).mime,
    "application/pdf",
  );
  assert.equal(
    receiptFormat(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])).mime,
    "image/png",
  );
  assert.throws(
    () => receiptFormat(Buffer.from("<html>fake receipt</html>")),
    /comprobante/,
  );
  assert.throws(
    () => receiptFormat(Buffer.from("%PDF-1.7\ntruncated")),
    /comprobante/,
  );
});
