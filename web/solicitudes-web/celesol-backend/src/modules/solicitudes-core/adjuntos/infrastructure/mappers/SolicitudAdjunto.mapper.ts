import type { Prisma } from "@prisma/client";

import type { SolicitudAdjunto } from "../../domain/entities/SolicitudAdjunto.entity";

type PrismaSolicitudAdjuntoShape = Prisma.SolicitudAdjuntoGetPayload<object> & {
  uploadedByUser?: {
    firstName: string | null;
    lastName: string | null;
  } | null;
};

export class SolicitudAdjuntoMapper {
  static toDomain(record: PrismaSolicitudAdjuntoShape): SolicitudAdjunto {
    return {
      adicional: record.adicional,
      archivoMimeType: record.archivoMimeType,
      archivoNombre: record.archivoNombre,
      archivoPath: record.archivoPath,
      archivoSizeBytes:
        record.archivoSizeBytes === null ? null : Number(record.archivoSizeBytes),
      comentario: record.comentario,
      deleteReason: record.deleteReason,
      deletedAt: record.deletedAt,
      deletedBy: record.deletedBy,
      descripcion: record.descripcion,
      estadoAdjunto: record.estadoAdjunto,
      id: record.id,
      nroDocumento: record.nroDocumento,
      restringido: record.restringido,
      solicitudId: record.solicitudId,
      storageBucket: record.storageBucket,
      tipoAdjunto: record.tipoAdjunto,
      updatedAt: record.updatedAt,
      uploadedAt: record.uploadedAt,
      uploadedBy: record.uploadedBy,
      uploadedByName: formatUploadedByName(record.uploadedByUser),
    };
  }
}

function formatUploadedByName(
  user: PrismaSolicitudAdjuntoShape["uploadedByUser"],
) {
  const fullName = [user?.firstName, user?.lastName]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ");

  return fullName || null;
}
