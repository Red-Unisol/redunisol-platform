import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { notifySignatureEvent, notifySignatureLinkAvailable, signatureEventKey } from "./SignatureNotifications";

function fixture() {
  const rows = new Map<string, Record<string, unknown>>();
  const source = { id: "application", legacyOid: "443444", nroSolicitud: "123", linkFirmaDigital: "https://example.invalid/sign",
    vendedorId: "seller", createdBy: "creator", archivedAt: null };
  const db = {
    solicitud: { findUnique: async () => source },
    user: { findFirst: async ({ where }: { where: { id: string } }) => ({ id: where.id }),
      findMany: async () => [{ id: "reviewer" }] },
    beexNotification: { createMany: async (input: { data: Record<string, unknown>[]; skipDuplicates: boolean }) => {
      assert.equal(input.skipDuplicates, true);
      for (const row of input.data) rows.set(`${row.recipientId}:${row.eventKey}`, row);
    } },
  } as unknown as Prisma.TransactionClient;
  return { db, rows, source };
}

test("link notifications target the seller, deduplicate retries and distinguish replacement loans", async () => {
  const { db, rows, source } = fixture();
  await notifySignatureLinkAvailable(db, source.id);
  await notifySignatureLinkAvailable(db, source.id);
  assert.equal(rows.size, 1);
  assert.equal([...rows.values()][0]!.recipientId, "seller");
  assert.equal([...rows.values()][0]!.kind, "signature_link_available");
  source.legacyOid = "443445";
  await notifySignatureLinkAvailable(db, source.id);
  assert.equal(rows.size, 2);
});

test("every completed attempt has one review notification; old-loan events are ignored", async () => {
  const { db, rows, source } = fixture();
  const event = { type: "signature_received" as const, solicitudId: source.id, loanId: source.legacyOid, cycleId: "cycle", verificationId: "attempt1" };
  await notifySignatureEvent(db, event);
  await notifySignatureEvent(db, event);
  assert.equal(rows.size, 1);
  assert.equal([...rows.values()][0]!.recipientId, "reviewer");
  await notifySignatureEvent(db, { ...event, verificationId: "attempt2" });
  assert.equal(rows.size, 2);
  await notifySignatureEvent(db, { ...event, loanId: "previous-loan", verificationId: "attempt3" });
  assert.equal(rows.size, 2);
});

test("requesting a signature notifies its reason to seller and uses a new cycle", async () => {
  const { db, rows, source } = fixture();
  await notifySignatureEvent(db, { type: "signature_requested", solicitudId: source.id, loanId: source.legacyOid,
    cycleId: "second-cycle", requestId: "request1", reason: "DNI borroso" });
  assert.equal(rows.size, 1);
  const notification = [...rows.values()][0]!;
  assert.equal(notification.recipientId, "seller");
  assert.match(notification.body as string, /DNI borroso/);
  assert.notEqual(signatureEventKey(["signature_received", "a", "bc"]), signatureEventKey(["signature_received", "ab", "c"]));
});
