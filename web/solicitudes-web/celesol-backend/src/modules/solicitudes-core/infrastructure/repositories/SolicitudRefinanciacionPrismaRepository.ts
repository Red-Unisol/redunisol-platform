import type { DbClient } from "../../../../db/prisma";
import type {
  SolicitudRefinanciacion,
  SolicitudRefinanciacionRepository,
} from "../../domain/repositories/SolicitudRefinanciacionRepository";

export class SolicitudRefinanciacionPrismaRepository
  implements SolicitudRefinanciacionRepository
{
  private readonly prisma: DbClient;

  constructor(prisma: DbClient) {
    this.prisma = prisma;
  }

  async findBySolicitudId(solicitudId: string) {
    return this.load(this.prisma, solicitudId);
  }

  async marcarCobrado(
    input: Parameters<SolicitudRefinanciacionRepository["marcarCobrado"]>[0],
  ) {
    await this.prisma.solicitudRefinanciacion.update({
      data: {
        cobradoAt: new Date(),
        cobroLegacyId: input.cobroId,
        totalCobrado: input.totalCobrado,
      },
      where: {
        solicitudId_prestamoLegacyId: {
          prestamoLegacyId: input.prestamoId,
          solicitudId: input.solicitudId,
        },
      },
    });
  }

  async replace(
    input: Parameters<SolicitudRefinanciacionRepository["replace"]>[0],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.solicitudRefinanciacion.deleteMany({
        where: { solicitudId: input.solicitudId },
      });

      if (input.prestamos.length > 0) {
        await tx.solicitudRefinanciacion.createMany({
          data: input.prestamos.map((prestamo) => ({
            nrosCuota: prestamo.nrosCuota,
            prestamoLegacyId: prestamo.prestamoId,
            solicitudId: input.solicitudId,
            updatedBy: input.updatedBy,
          })),
        });
      }

      return this.load(tx, input.solicitudId);
    });
  }

  private async load(
    client: Pick<DbClient, "solicitudRefinanciacion">,
    solicitudId: string,
  ): Promise<SolicitudRefinanciacion> {
    const rows = await client.solicitudRefinanciacion.findMany({
      orderBy: { prestamoLegacyId: "asc" },
      where: { solicitudId },
    });

    return {
      prestamos: rows.map((row) => ({
        cobro:
          row.cobroLegacyId && row.cobradoAt
            ? {
                cobradoAt: row.cobradoAt,
                cobroId: row.cobroLegacyId,
                totalCobrado: row.totalCobrado?.toNumber() ?? 0,
              }
            : null,
        nrosCuota: [...row.nrosCuota].sort((a, b) => a - b),
        prestamoId: row.prestamoLegacyId,
      })),
      updatedAt: rows.reduce<Date | null>(
        (latest, row) => (!latest || row.updatedAt > latest ? row.updatedAt : latest),
        null,
      ),
    };
  }
}
