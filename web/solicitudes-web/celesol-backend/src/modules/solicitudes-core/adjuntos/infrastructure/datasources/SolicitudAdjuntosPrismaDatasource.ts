import type { DbClient } from "../../../../../db/prisma";

import type {
  CreateSolicitudAdjuntoRecord,
  SoftDeleteSolicitudAdjuntoInput,
  UpdateSolicitudAdjuntoInput,
} from "../../domain/repositories/SolicitudAdjuntoRepository";
import { SellerReviewChangedDuringUploadError } from "../../domain/solicitudes-adjuntos-errors";
import { SolicitudAdjuntoMapper } from "../mappers/SolicitudAdjunto.mapper";

const solicitudAdjuntoInclude = {
  uploadedByUser: {
    select: {
      firstName: true,
      lastName: true,
    },
  },
};

export class SolicitudAdjuntosPrismaDatasource {
  private readonly prisma: DbClient;

  constructor(prisma: DbClient) {
    this.prisma = prisma;
  }

  private createRecord(executor: Pick<DbClient, "solicitudAdjunto">, input: CreateSolicitudAdjuntoRecord) {
    return executor.solicitudAdjunto.create({
      data: {
        adicional: input.adicional,
        archivoMimeType: input.archivoMimeType,
        archivoNombre: input.archivoNombre,
        archivoPath: input.archivoPath,
        archivoSizeBytes:
          input.archivoSizeBytes === null ? null : BigInt(input.archivoSizeBytes),
        comentario: input.comentario,
        descripcion: input.descripcion,
        estadoAdjunto: input.estadoAdjunto,
        id: input.adjuntoId,
        nroDocumento: input.nroDocumento,
        restringido: input.restringido,
        solicitudId: input.solicitudId,
        storageBucket: input.storageBucket,
        tipoAdjunto: input.tipoAdjunto,
        uploadedBy: input.uploadedBy,
      },
      include: solicitudAdjuntoInclude,
    });
  }

  async create(input: CreateSolicitudAdjuntoRecord, sellerReviewStartedAt?: Date) {
    if (sellerReviewStartedAt) {
      const [adjunto] = await this.createMany([input], sellerReviewStartedAt);
      return adjunto;
    }
    return SolicitudAdjuntoMapper.toDomain(await this.createRecord(this.prisma, input));
  }

  async createMany(inputs: CreateSolicitudAdjuntoRecord[], sellerReviewStartedAt?: Date) {
    const solicitudId = inputs[0]?.solicitudId;
    const created = sellerReviewStartedAt && solicitudId
      ? await this.prisma.$transaction(async tx => {
          // Share the review's lock so an upload started in Liquidada
          // cannot save with stale permissions after review completion.
          const [current] = await tx.$queryRaw<{ startedAt: Date | null }[]>`
            SELECT s.seller_review_started_at AS "startedAt"
            FROM solicitudes s
            JOIN workflow_states w ON w.id = s.estado_actual_id
            WHERE s.id = ${solicitudId}::uuid AND w.code = 'Liquidada'
            FOR UPDATE OF s
          `;
          if (current?.startedAt?.getTime() !== sellerReviewStartedAt.getTime()) {
            throw new SellerReviewChangedDuringUploadError();
          }
          return Promise.all(inputs.map(input => this.createRecord(tx, input)));
        })
      : await this.prisma.$transaction(inputs.map(input => this.createRecord(this.prisma, input)));
    return created.map(SolicitudAdjuntoMapper.toDomain);
  }

  async findById(id: string) {
    const adjunto = await this.prisma.solicitudAdjunto.findUnique({
      where: {
        id,
      },
      include: solicitudAdjuntoInclude,
    });

    return adjunto ? SolicitudAdjuntoMapper.toDomain(adjunto) : null;
  }

  async listBySolicitudId(solicitudId: string) {
    const adjuntos = await this.prisma.solicitudAdjunto.findMany({
      where: {
        solicitudId,
      },
      orderBy: {
        uploadedAt: "desc",
      },
      include: solicitudAdjuntoInclude,
    });

    return adjuntos.map(SolicitudAdjuntoMapper.toDomain);
  }

  async softDelete(input: SoftDeleteSolicitudAdjuntoInput) {
    const adjunto = await this.prisma.solicitudAdjunto.update({
      where: {
        id: input.adjuntoId,
      },
      data: {
        deleteReason: input.deleteReason,
        deletedAt: input.deletedAt,
        deletedBy: input.deletedBy,
      },
      include: solicitudAdjuntoInclude,
    });

    return SolicitudAdjuntoMapper.toDomain(adjunto);
  }

  async update(input: UpdateSolicitudAdjuntoInput) {
    const adjunto = await this.prisma.solicitudAdjunto.update({
      where: {
        id: input.adjuntoId,
      },
      data: {
        ...(input.tipoAdjunto !== undefined && { tipoAdjunto: input.tipoAdjunto }),
        ...(input.descripcion !== undefined && { descripcion: input.descripcion }),
        ...(input.adicional !== undefined && { adicional: input.adicional }),
        ...(input.comentario !== undefined && { comentario: input.comentario }),
        ...(input.nroDocumento !== undefined && { nroDocumento: input.nroDocumento }),
        ...(input.restringido !== undefined && { restringido: input.restringido }),
      },
      include: solicitudAdjuntoInclude,
    });

    return SolicitudAdjuntoMapper.toDomain(adjunto);
  }
}
