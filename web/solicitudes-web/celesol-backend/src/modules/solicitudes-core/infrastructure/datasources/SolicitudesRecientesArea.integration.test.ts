import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, it } from "node:test";
import { prisma, type DbClient } from "../../../../db/prisma";
import { SolicitudesCorePrismaDatasource, HISTORICAS_NEGATIVE_STATE_CODES } from "./SolicitudesCorePrismaDatasource";

after(() => prisma.$disconnect());

it("Recientes filtra por área antes de paginar e incorpora cambios de estado, con y sin ejecutivo", async () => {
  const rollback = new Error("rollback test fixtures");
  await assert.rejects(prisma.$transaction(async (tx) => {
    const states = await tx.workflowState.findMany({
      where: { isActive: true, code: { not: "CargaVendedor" } },
      include: { owner: true },
    });
    const byArea = ["RIESGO", "VENDEDORES", "TESORERIA"].map((code) => {
      const state = states.find((state) => state.owner.code === code);
      assert(state, `Falta estado de ${code}`);
      return state;
    });
    const uuid = randomUUID();
    const user = await tx.user.create({ data: { email: `${uuid}@example.test`, legacyUser: uuid, passwordHash: "test-only" } });
    const doc = uuid;
    const base = { createdBy: user.id, lineaPrestamoLegacyOid: "test", lineaPrestamoDescripcion: "test" };
    const ids: string[] = [];
    for (const [i, state] of byArea.entries()) {
      for (const assigned of [false, true]) {
        const row = await tx.solicitud.create({ data: { ...base, estadoActualId: state.id,
          createdAt: new Date(`2026-10-0${i + 2}T12:${assigned ? "01" : "00"}:00Z`),
          assignedToUserId: assigned ? user.id : null,
          titular: { create: { nroDocumento: doc } },
        } });
        ids.push(row.id);
      }
    }
    await tx.solicitud.create({ data: { ...base, estadoActualId: byArea[0].id, createdAt: new Date("2020-01-01"), titular: { create: { nroDocumento: doc } } } });
    const datasource = new SolicitudesCorePrismaDatasource(tx as unknown as DbClient);
    const query = { createdFrom: "2026-10-01", createdTo: "2026-10-11", nroDocumento: doc, limit: 1, offset: 0 };
    for (const state of byArea) {
      if (HISTORICAS_NEGATIVE_STATE_CODES.some((code) => code === state.code)) {
        assert.equal((await datasource.listRecientes({ ...query, estadoOwnerId: state.ownerId })).length, 0);
        continue;
      }
      const first = await datasource.listRecientes({ ...query, estadoOwnerId: state.ownerId });
      const second = await datasource.listRecientes({ ...query, estadoOwnerId: state.ownerId, offset: 1 });
      assert.equal(first.length, 1);
      assert.equal(second.length, 1);
      assert.equal(first[0].estadoActual.ownerId, state.ownerId);
      assert.equal(second[0].estadoActual.ownerId, state.ownerId);
      assert.equal(first[0].assignedToUserId, user.id);
      assert.equal(second[0].assignedToUserId, null);
    }
    assert.equal((await datasource.listRecientes({ ...query, limit: 100 })).length, 4);
    assert.equal((await datasource.listRecientes({ ...query, limit: 100, creadoPorIn: [] })).length, 0);
    await tx.solicitud.update({ where: { id: ids[0] }, data: { estadoActualId: byArea[1].id } });
    assert.equal((await datasource.listRecientes({ ...query, limit: 100, estadoOwnerId: byArea[0].ownerId })).length, 1);
    assert.equal((await datasource.listRecientes({ ...query, limit: 100, estadoOwnerId: byArea[1].ownerId })).length, 3);
    throw rollback;
  }, { timeout: 15000 }), (error) => error === rollback);
});
