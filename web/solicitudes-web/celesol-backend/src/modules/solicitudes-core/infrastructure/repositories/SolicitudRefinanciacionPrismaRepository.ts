import type { DbClient } from "../../../../db/prisma";
import { administrativeSource } from "../services/AdministrativeCorrectionService";
import { AdministrativeCorrectionError, assertNoLoanReplacementPending } from "../../domain/workflow/AdministrativeCorrection";
import { SolicitudRefinanciacionPrestamoGeneradoError, SolicitudRefinanciacionYaCobradaError } from "../../domain/solicitudes-core-errors";
import { refinanciacionVersion } from "../../domain/repositories/SolicitudRefinanciacionRepository";
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

  async findBySolicitudId(solicitudId: string) {
    return this.load(this.prisma, solicitudId);
  }

  async replace(
    input: Parameters<SolicitudRefinanciacionRepository["replace"]>[0],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${input.solicitudId}::uuid FOR UPDATE`;
      const solicitud = await administrativeSource(tx, input.solicitudId);
      assertNoLoanReplacementPending(solicitud);
      if (solicitud.legacyOid) throw new SolicitudRefinanciacionPrestamoGeneradoError();
      const actual = await this.load(tx, input.solicitudId);
      if (actual.prestamos.some(p => p.cobros.length > 0)) throw new SolicitudRefinanciacionYaCobradaError();
      if (solicitud.updatedAt.getTime() !== input.expectedSolicitudUpdatedAt.getTime() ||
        refinanciacionVersion(actual) !== input.expectedVersion)
        throw new AdministrativeCorrectionError("La solicitud o la refinanciación cambió mientras se calculaba. Actualizá el detalle y volvé a revisar.");
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

      // Invalidate preparations and saves that started before this selection.
      await tx.solicitud.update({ where: { id: input.solicitudId }, data: { updatedAt: new Date() } });
      return this.load(tx, input.solicitudId);
    });
  }

  static async load(
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

  private load(client: Pick<DbClient, "solicitudRefinanciacion">, id: string) {
    return SolicitudRefinanciacionPrismaRepository.load(client, id);
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
