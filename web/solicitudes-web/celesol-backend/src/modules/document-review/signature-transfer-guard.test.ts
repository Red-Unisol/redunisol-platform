import assert from "node:assert/strict";
import test from "node:test";
import { assertSignatureTransferReady, finalizationAction } from "./signature-transfer-guard";
import type { SignatureDatabase } from "./signature-workflow";

test("analysis completion selects the route independently from loan generation", () => {
  assert.equal(finalizationAction(false), "liquidar");
  assert.equal(finalizationAction(true), "liquidar_con_firma");
});

test("transferring fails closed when analysis has not finished", async () => {
  const db = { solicitud: { findUnique: async () => ({ analisisFinalizadoAt: null, estadoActual: { code: "Confirmada" } }) } } as unknown as SignatureDatabase;
  await assert.rejects(assertSignatureTransferReady(db, "s"), /Finalizá el análisis/);
});
