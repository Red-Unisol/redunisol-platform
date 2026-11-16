import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  MonthlyCutoffError,
  type CutoffRecord,
  type CutoffRepository,
} from "./domain";
export class PrismaCutoffRepository implements CutoffRepository {
  constructor(private readonly db: PrismaClient) {}
  private map(row: {
    period: string;
    cutoffDate: Date;
    note: string | null;
    version: number;
    updatedAt: Date;
    actorName: string;
  }): CutoffRecord {
    return {
      period: row.period,
      cutoffDate: row.cutoffDate.toISOString().slice(0, 10),
      note: row.note,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.actorName,
    };
  }
  async find(period: string) {
    const row = await this.db.monthlyCutoff.findUnique({ where: { period } });
    return row ? this.map(row) : null;
  }
  async history(period: string) {
    const rows = await this.db.monthlyCutoffChange.findMany({
      where: { period },
      orderBy: { version: "desc" },
      take: 50,
    });
    return rows.map((row) => ({
      ...this.map({ ...row, updatedAt: row.createdAt }),
      previousDate: row.previousDate?.toISOString().slice(0, 10) ?? null,
    }));
  }
  async save(input: Parameters<CutoffRepository["save"]>[0]) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"amejuca-cutoff:" + input.period}))`;
      const current = await tx.monthlyCutoff.findUnique({
        where: { period: input.period },
      });
      if (
        current &&
        current.cutoffDate.toISOString().slice(0, 10) === input.cutoffDate &&
        current.note === input.note
      )
        return this.map(current);
      if ((current?.version ?? 0) !== input.expectedVersion)
        throw new MonthlyCutoffError(
          "Otro analista modificó este corte. Recargá el período y revisá la fecha antes de guardar.",
          409,
        );
      const data = {
        cutoffDate: new Date(input.cutoffDate + "T00:00:00Z"),
        note: input.note,
        version: input.expectedVersion + 1,
        actorName: input.actorName,
      };
      const row = await tx.monthlyCutoff.upsert({
        where: { period: input.period },
        create: { period: input.period, ...data },
        update: data,
      });
      await tx.monthlyCutoffChange.create({
        data: {
          id: randomUUID(),
          period: input.period,
          ...data,
          previousDate: current?.cutoffDate ?? null,
          actorId: input.actorId,
          realActorId: input.realActorId,
        },
      });
      return this.map(row);
    });
  }
}
