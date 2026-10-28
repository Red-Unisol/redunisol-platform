import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { SolicitudesCorePrismaDatasource } from "./SolicitudesCorePrismaDatasource";
import type { DbClient } from "../../../../db/prisma";

const url = process.env.BEEX_TEST_DATABASE_URL;
const db = new PrismaClient({ datasourceUrl: url });
after(() => db.$disconnect());
function assertLocalTestDatabase() {
  const parsed = new URL(url!);
  assert(["127.0.0.1", "localhost"].includes(parsed.hostname) && parsed.pathname.endsWith("_test"));
}

it("number migration starts at 500001, backfills in creation order and preserves existing references and guards", { skip: !url }, async () => {
  assertLocalTestDatabase();
  const migration = await readFile(path.resolve("prisma/migrations/20261028170000_solicitud_numbers/migration.sql"), "utf8");
  for (const existing of [false, true]) {
    const schema = `number_test_${randomUUID().replaceAll("-", "")}`;
    const rollback = new Error("ROLLBACK_NUMBER_MIGRATION");
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe("CREATE TABLE solicitudes (id text PRIMARY KEY, created_at timestamp NOT NULL, nro_solicitud text UNIQUE)");
      // Any update would fail without the migration's narrowly scoped guard suspension.
      await tx.$executeRawUnsafe("CREATE FUNCTION freeze_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'RESERVATION_GUARD_ACTIVE'; END; $$");
      await tx.$executeRawUnsafe("CREATE TRIGGER freeze_reserved_solicitud BEFORE UPDATE ON solicitudes FOR EACH ROW EXECUTE FUNCTION freeze_test()");
      if (existing) {
        await tx.$executeRawUnsafe("INSERT INTO solicitudes VALUES ('later', '2026-10-02', NULL), ('earlier', '2026-10-01', NULL), ('assigned', '2026-09-01', '500010')");
      }
      // Execute the real migration inside this rollback-only schema transaction.
      for (const sql of migration.split(";").map(value => value.trim()).filter(Boolean)) {
        if (sql === "BEGIN" || sql === "COMMIT") continue;
        await tx.$executeRawUnsafe(sql);
      }
      const rows = await tx.$queryRaw<{ id: string; nro_solicitud: string }[]>`SELECT id, nro_solicitud FROM solicitudes ORDER BY created_at, id`;
      assert.deepEqual(rows.map(row => row.nro_solicitud), existing ? ["500010", "500011", "500012"] : []);
      const [next] = await tx.$queryRaw<{ nro_solicitud: string }[]>`INSERT INTO solicitudes(id, created_at) VALUES ('new', NOW()) RETURNING nro_solicitud`;
      assert.equal(next!.nro_solicitud, existing ? "500013" : "500001");
      await tx.$executeRawUnsafe("SAVEPOINT guard_check");
      await assert.rejects(tx.$executeRawUnsafe("UPDATE solicitudes SET created_at=NOW() WHERE id='new'"), /RESERVATION_GUARD_ACTIVE/);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT guard_check");
      throw rollback;
    }), error => error === rollback);
  }
});

it("PostgreSQL assigns unique numeric references concurrently, never reuses rolled-back numbers and searches before pagination", { skip: !url }, async () => {
  assertLocalTestDatabase();
  const marker = randomUUID();
  const owner = await db.workflowOwner.create({ data: { code: marker, name: "Number test" } });
  const state = await db.workflowState.create({ data: { code: marker, name: "Number test", ownerId: owner.id } });
  const user = await db.user.create({ data: { email: `${marker}@example.test`, legacyUser: marker, passwordHash: "test-only" } });
  const data = {
    createdBy: user.id, estadoActualId: state.id,
    lineaPrestamoLegacyOid: "test", lineaPrestamoDescripcion: "Number test",
    titular: { create: { nombre: "Número", apellidoDenominacion: "Ejemplo", nroDocumento: marker } },
  };
  try {
    const rows = await Promise.all(Array.from({ length: 12 }, () => db.solicitud.create({ data })));
    const numbers = rows.map(row => row.nroSolicitud!);
    assert(numbers.every(number => /^[0-9]+$/.test(number) && BigInt(number) >= 500001n));
    assert.equal(new Set(numbers).size, rows.length);
    let rolledBackNumber = "";
    const rollback = new Error("ROLLBACK_NUMBER_TEST");
    await assert.rejects(db.$transaction(async tx => {
      rolledBackNumber = (await tx.solicitud.create({ data })).nroSolicitud!;
      throw rollback;
    }), error => error === rollback);
    const next = await db.solicitud.create({ data });
    assert(BigInt(next.nroSolicitud!) > BigInt(rolledBackNumber));
    const saved = await db.solicitud.update({ where: { id: next.id }, data: { observaciones: "Updated" } });
    assert.equal(saved.nroSolicitud, next.nroSolicitud);
    await assert.rejects(db.solicitud.create({ data: { ...data, nroSolicitud: next.nroSolicitud } }), /Unique constraint/);
    const disposable = await db.solicitud.create({ data });
    await db.solicitudTitular.deleteMany({ where: { solicitudId: disposable.id } });
    await db.solicitud.delete({ where: { id: disposable.id } });
    const afterDelete = await db.solicitud.create({ data });
    assert(BigInt(afterDelete.nroSolicitud!) > BigInt(disposable.nroSolicitud!));

    const datasource = new SolicitudesCorePrismaDatasource(db as DbClient);
    const query = { search: next.nroSolicitud!, creadoPorIn: [user.id], limit: 1, offset: 0 };
    assert.deepEqual((await datasource.listRecientes(query)).map(row => row.id), [next.id]);
    assert.deepEqual((await datasource.listByOwner(query)).map(row => row.id), [next.id]);
    assert.equal((await datasource.listRecientes({ ...query, creadoPorIn: [] })).length, 0);
    await db.solicitud.update({ where: { id: next.id }, data: { createdAt: new Date("2020-01-01") } });
    assert.deepEqual((await datasource.listHistoricas(query)).map(row => row.id), [next.id]);
    assert.equal((await datasource.listHistoricas({ ...query, creadoPorIn: [] })).length, 0);
  } finally {
    await db.solicitudTitular.deleteMany({ where: { solicitud: { createdBy: user.id } } });
    await db.solicitud.deleteMany({ where: { createdBy: user.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.workflowState.delete({ where: { id: state.id } });
    await db.workflowOwner.delete({ where: { id: owner.id } });
  }
});
