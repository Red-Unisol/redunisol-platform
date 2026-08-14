import type { Prisma } from "@prisma/client";

import type { SolicitudCancelacion } from "../../domain/entities/SolicitudCancelacion.entity";

type PrismaSolicitudCancelacionShape =
  Prisma.SolicitudCancelacionGetPayload<object> & {
    createdByUser?: {
      firstName: string | null;
      lastName: string | null;
    } | null;
  };

export class SolicitudCancelacionMapper {
  static toDomain(
    record: PrismaSolicitudCancelacionShape,
  ): SolicitudCancelacion {
    return {
      cbu: record.cbu,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
      createdByName: formatCreatedByName(record.createdByUser),
      cuentaADebitar: record.cuentaADebitar,
      cuentaBancaria: record.cuentaBancaria,
      deletedAt: record.deletedAt,
      deletedBy: record.deletedBy,
      id: record.id,
      monto: Number(record.monto),
      notas: record.notas,
      socio: record.socio,
      socioLegacyId: record.socioLegacyId,
      solicitudId: record.solicitudId,
      updatedAt: record.updatedAt,
    };
  }
}

function formatCreatedByName(
  user: PrismaSolicitudCancelacionShape["createdByUser"],
) {
  const fullName = [user?.firstName, user?.lastName]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ");

  return fullName || null;
}
