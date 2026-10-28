import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createLoanDiagnosticWriter } from "./LoanDiagnostics";

const databaseUrl = process.env.BEEX_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl);
const db = new PrismaClient({ datasourceUrl: databaseUrl });
after(() => db.$disconnect());

function assertTestDatabase() {
  const url = new URL(databaseUrl!);
  assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.endsWith("_test"), "Use an isolated local test database");
}
const row = () => ({
  operationId: randomUUID(), solicitudId: randomUUID(), actorId: randomUUID(), realActorId: randomUUID(),
  operation: "loan_generation", stage: "DB_TEST", callId: randomUUID(), data: { synthetic: true, amount: 500000 },
});
const ROLLBACK = "ROLLBACK_TECHNICAL_DIAGNOSTIC_TEST";

it("real PostgreSQL preserves append-only diagnostics against UPDATE, DELETE and TRUNCATE", { skip: !enabled }, async () => {
  assertTestDatabase();
  await assert.rejects(db.$transaction(async tx => {
    const original = await tx.technicalDiagnosticEvent.create({ data: row() });
    for (const mutation of ["update", "delete", "truncate"] as const) {
      await tx.$executeRawUnsafe("SAVEPOINT diagnostic_immutability");
      try {
        if (mutation === "update") {
          await assert.rejects(tx.$executeRaw`UPDATE technical_diagnostic_events SET stage='CHANGED' WHERE id=${original.id}`, /BEEX_TECHNICAL_DIAGNOSTIC_IMMUTABLE/);
        } else if (mutation === "delete") {
          await assert.rejects(tx.$executeRaw`DELETE FROM technical_diagnostic_events WHERE id=${original.id}`, /BEEX_TECHNICAL_DIAGNOSTIC_IMMUTABLE/);
        } else {
          await assert.rejects(tx.$executeRawUnsafe("TRUNCATE TABLE technical_diagnostic_events"), /BEEX_TECHNICAL_DIAGNOSTIC_IMMUTABLE/);
        }
      } finally {
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT diagnostic_immutability");
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT diagnostic_immutability");
      }
      assert.deepEqual(await tx.technicalDiagnosticEvent.findUnique({ where: { id: original.id } }), original);
    }
    throw new Error(ROLLBACK);
  }), new RegExp(ROLLBACK));
});

it("database timestamp default records the same instant across UTC and non-UTC sessions without caller timestamps", { skip: !enabled }, async () => {
  assertTestDatabase();
  await assert.rejects(db.$transaction(async tx => {
    const timestamps: number[] = [];
    for (const zone of ["UTC", "Pacific/Kiritimati", "America/Argentina/Buenos_Aires"]) {
      await tx.$queryRaw`SELECT set_config('TimeZone', ${zone}, true)`;
      // Omit recorded_at in SQL so this verifies the actual database default,
      // independently of Prisma's @default(now()) value generation.
      const [inserted] = await tx.$queryRaw<{ id: bigint }[]>`
        INSERT INTO technical_diagnostic_events(operation_id, operation, stage, data)
        VALUES (${randomUUID()}::uuid, 'loan_generation', 'TIMEZONE_TEST', '{}'::jsonb)
        RETURNING id`;
      assert(inserted);
      const saved = await tx.technicalDiagnosticEvent.findUniqueOrThrow({ where: { id: inserted.id } });
      const [observed] = await tx.$queryRaw<{ epoch: number; nowEpoch: number; timestampType: string }[]>`
        SELECT EXTRACT(EPOCH FROM recorded_at)::double precision AS epoch,
          EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::double precision AS "nowEpoch",
          pg_typeof(recorded_at)::text AS "timestampType"
        FROM technical_diagnostic_events WHERE id=${saved.id}`;
      assert(observed);
      assert.equal(observed.timestampType, "timestamp with time zone");
      assert(Math.abs(observed.epoch - observed.nowEpoch) < 0.01, JSON.stringify({ zone, ...observed, returnedDate: saved.recordedAt.toISOString() }));
      assert(Math.abs(saved.recordedAt.getTime() / 1000 - observed.epoch) < 0.001);
      timestamps.push(saved.recordedAt.getTime());
    }
    assert(Math.max(...timestamps) - Math.min(...timestamps) <= 1, "CURRENT_TIMESTAMP must keep the transaction instant in every timezone");
    throw new Error(ROLLBACK);
  }), new RegExp(ROLLBACK));
});

it("real writer persists complete sanitized payloads without requiring application FK records", { skip: !enabled }, async () => {
  assertTestDatabase();
  const operationId = randomUUID();
  const body = JSON.stringify({ ID: "443444", detail: "complete-response-".repeat(20000), password: "synthetic-secret-with-spaces" });
  await assert.rejects(db.$transaction(async tx => {
    const writer = createLoanDiagnosticWriter(tx as unknown as Pick<PrismaClient, "technicalDiagnosticEvent">);
    await writer({ operationId, solicitudId: randomUUID(), actorId: randomUUID(), realActorId: randomUUID(), operation: "loan_generation" }, {
      stage: "HTTP_RESPONSE", callId: randomUUID(), elapsedMs: 12, data: { status: 200, body },
    }, true);
    const saved = await tx.technicalDiagnosticEvent.findFirstOrThrow({ where: { operationId } });
    const payload = saved.data as { status: number; body: string };
    assert.equal(payload.status, 200);
    const parsed = JSON.parse(payload.body);
    assert.equal(parsed.ID, "443444");
    assert.equal(parsed.detail, "complete-response-".repeat(20000));
    assert.equal(parsed.password, "[REDACTED]");
    throw new Error(ROLLBACK);
  }), new RegExp(ROLLBACK));
  assert.equal(await db.technicalDiagnosticEvent.count({ where: { operationId } }), 0);
});
