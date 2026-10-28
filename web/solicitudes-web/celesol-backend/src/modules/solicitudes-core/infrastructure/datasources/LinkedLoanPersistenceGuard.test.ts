import assert from "node:assert/strict";
import { it } from "node:test";
import type { DbClient } from "../../../../db/prisma";
import { SolicitudesCorePrismaDatasource } from "./SolicitudesCorePrismaDatasource";

function fixture(legacyOid: string | null = "444", pending = false) {
  let writes = 0, locks = 0;
  const db = {
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({
      $queryRaw: async () => { locks++; return []; },
      solicitud: {
        findUnique: async () => ({ estadoActualId: "state", legacyOid, montoAFinanciar: 10000,
          administrativeCoreControl: pending ? { generationPending: { status: "UNCERTAIN" } } : null,
          estadoActual: { code: "Revisar" }, montoAprobadoRiesgo: null }),
        update: async () => { writes++; throw new Error("persistence reached"); },
      },
    }),
  } as unknown as DbClient;
  return { ds: new SolicitudesCorePrismaDatasource(db), writes: () => writes, locks: () => locks };
}

it("an internal amount update without a verified cancellation cannot bypass the frozen amount", async () => {
  const f = fixture();
  await assert.rejects(f.ds.update("sol", { solicitud: { montoAFinanciar: 20000 } }), /congelado.*444/);
  assert.equal(f.writes(), 0);
  assert.equal(f.locks(), 1);
});

it("a replacement linked after external cancellation checking invalidates that check under the row lock", async () => {
  const f = fixture("555");
  await assert.rejects(f.ds.update("sol", { solicitud: { montoAFinanciar: 20000 } }, {
    expectedEstadoActualId: "state", enforceMontoAprobadoRiesgo: false, expectedLegacyOid: "444", cancelledLoanId: "444",
  }));
  assert.equal(f.writes(), 0);
});

it("the same proven cancelled loan may reach persistence and an uncertain generation never may", async () => {
  const f = fixture();
  await assert.rejects(f.ds.update("sol", { solicitud: { montoAFinanciar: 20000 } }, {
    expectedEstadoActualId: "state", enforceMontoAprobadoRiesgo: false, expectedLegacyOid: "444", cancelledLoanId: "444",
  }), /persistence reached/);
  assert.equal(f.writes(), 1);
  const pending = fixture(null, true);
  await assert.rejects(pending.ds.update("sol", { solicitud: { montoAFinanciar: 20000 } }), /generación.*incierto/);
  assert.equal(pending.writes(), 0);
});
