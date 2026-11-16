import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { PrismaCutoffRepository } from "./PrismaCutoffRepository";
const url = process.env.BEEX_TEST_DATABASE_URL;
it(
  "saves atomically, rejects concurrent stale writes and preserves immutable audit history",
  { skip: !url },
  async () => {
    const parsed = new URL(url!);
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) &&
        parsed.pathname.endsWith("_test"),
      "Use an isolated local *_test database",
    );
    const db = new PrismaClient({ datasourceUrl: url });
    try {
      const actor = await db.user.create({
        data: {
          email: randomUUID() + "@example.invalid",
          legacyUser: randomUUID(),
          passwordHash: "test-only",
        },
      });
      const repository = new PrismaCutoffRepository(db);
      const input = {
        period: "2028-02",
        cutoffDate: "2028-02-07",
        note: "Aviso de ejemplo",
        expectedVersion: 0,
        actorId: actor.id,
        actorName: "Analista de ejemplo",
        realActorId: actor.id,
      };
      const first = await repository.save(input);
      assert.equal(first.version, 1);
      const concurrent = await Promise.allSettled([
        repository.save({
          ...input,
          expectedVersion: 1,
          cutoffDate: "2028-02-08",
        }),
        repository.save({
          ...input,
          expectedVersion: 1,
          cutoffDate: "2028-02-09",
        }),
      ]);
      assert.equal(
        concurrent.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        concurrent.filter((result) => result.status === "rejected").length,
        1,
      );
      const current = (await repository.find(input.period))!;
      assert.equal(current.version, 2);
      await repository.save({ ...input, cutoffDate: current.cutoffDate }); // exact retry is idempotent
      assert.equal((await repository.history(input.period)).length, 2);
      await assert.rejects(
        db.monthlyCutoffChange.updateMany({
          where: { period: input.period },
          data: { note: "overwrite" },
        }),
        /BEEX_MONTHLY_CUTOFF_HISTORY_IMMUTABLE/,
      );
      await assert.rejects(
        db.monthlyCutoffChange.deleteMany({ where: { period: input.period } }),
        /BEEX_MONTHLY_CUTOFF_HISTORY_IMMUTABLE/,
      );
      await assert.rejects(
        db.monthlyCutoff.update({
          where: { period: input.period },
          data: { cutoffDate: new Date("2028-03-01") },
        }),
      );
    } finally {
      await db.$disconnect();
    }
  },
);
