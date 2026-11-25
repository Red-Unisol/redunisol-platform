import type { Prisma } from "@prisma/client";
import type { DbClient } from "../../../../db/prisma";
import { SolicitudesError } from "../../../solicitudes/domain/solicitudes-errors";
import {
  amejucaLineVariant,
  AmejucaLineUnavailableError,
  type AmejucaVariant,
} from "../../domain/services/AmejucaLineAvailability";

const settingId = 1;

export function readAmejucaLineAvailability(
  db: Pick<DbClient, "amejucaLineAvailability">,
) {
  return db.amejucaLineAvailability.findUniqueOrThrow({
    where: { id: settingId },
    select: { variant: true, version: true },
  });
}

export async function setAmejucaLineAvailability(
  db: DbClient,
  variant: AmejucaVariant,
  expectedVersion: number,
  actorId: string,
) {
  return db.$transaction(async (tx) => {
    const updated = await tx.amejucaLineAvailability.updateMany({
      where: {
        id: settingId,
        version: expectedVersion,
        variant: { not: variant },
      },
      data: { variant, version: { increment: 1 }, updatedBy: actorId },
    });
    const current = await readAmejucaLineAvailability(tx);
    if (updated.count === 0 && current.variant !== variant) {
      throw new SolicitudesError(
        "Otra persona cambió la variante de AMEJUCA. Volvé a consultar antes de guardar.",
        409,
      );
    }
    return current;
  });
}

export async function assertAmejucaLineAvailable(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  oid: string,
) {
  const variant = amejucaLineVariant(oid);
  if (!variant) return;

  // Las nuevas asignaciones de línea y los cambios de variante se serializan en esta fila.
  const [current] = await tx.$queryRaw<{ variant: AmejucaVariant }[]>`
    SELECT "variant"
    FROM "amejuca_line_availability"
    WHERE "id" = ${settingId}
    FOR SHARE
  `;
  if (!current) throw new Error("Falta la configuración de líneas de AMEJUCA.");
  if (current.variant !== variant) throw new AmejucaLineUnavailableError();
}
