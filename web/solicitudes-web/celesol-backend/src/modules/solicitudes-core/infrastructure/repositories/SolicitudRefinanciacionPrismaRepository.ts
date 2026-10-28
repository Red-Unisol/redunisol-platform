import type { DbClient } from "../../../../db/prisma";
import type {
  SolicitudRefinanciacion,
  SolicitudRefinanciacionCobro,
  SolicitudRefinanciacionRepository,
} from "../../domain/repositories/SolicitudRefinanciacionRepository";

type CobroGuardado = {
  cobradoAt: string;
  cobroId: string;
  nrosCuota: number[];
  totalCobrado: number;
};

export class SolicitudRefinanciacionPrismaRepository
  implements SolicitudRefinanciacionRepository
{
  private readonly prisma: DbClient;

  constructor(prisma: DbClient) {
    this.prisma = prisma;
  }

  async agregarCobro(
    input: Parameters<SolicitudRefinanciacionRepository["agregarCobro"]>[0],
  ) {
    const where = {
      solicitudId_prestamoLegacyId: {
        prestamoLegacyId: input.prestamoId,
        solicitudId: input.solicitudId,
      },
    };

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.solicitudRefinanciacion.findUniqueOrThrow({
        select: { cobros: true },
        where,
      });
      const cobro: CobroGuardado = {
        cobradoAt: new Date().toISOString(),
        cobroId: input.cobro.cobroId,
        nrosCuota: input.cobro.nrosCuota,
        totalCobrado: input.cobro.totalCobrado,
      };

      await tx.solicitudRefinanciacion.update({
        data: { cobros: [...leerCobros(row.cobros), cobro] },
        where,
      });
    });
  }

  async findBySolicitudId(solicitudId: string) {
    return this.load(this.prisma, solicitudId);
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
        cobros: leerCobros(row.cobros).map(
          (cobro): SolicitudRefinanciacionCobro => ({
            cobradoAt: new Date(cobro.cobradoAt),
            cobroId: cobro.cobroId,
            nrosCuota: cobro.nrosCuota,
            totalCobrado: cobro.totalCobrado,
          }),
        ),
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

// La columna es JSON: se descarta lo que no tenga la forma esperada en lugar
// de romper la lectura de toda la refinanciacion.
function leerCobros(value: unknown): CobroGuardado[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const cobro = (item ?? {}) as Record<string, unknown>;

    return typeof cobro.cobroId === "string" &&
      typeof cobro.totalCobrado === "number" &&
      Array.isArray(cobro.nrosCuota)
      ? [
          {
            cobradoAt:
              typeof cobro.cobradoAt === "string" ? cobro.cobradoAt : "",
            cobroId: cobro.cobroId,
            nrosCuota: cobro.nrosCuota.filter(
              (nro): nro is number => typeof nro === "number",
            ),
            totalCobrado: cobro.totalCobrado,
          },
        ]
      : [];
  });
}
