import type { DbClient } from "../../../../../db/prisma";

import type {
  CreateSolicitudAdjuntoRecord,
  SoftDeleteSolicitudAdjuntoInput,
  UpdateSolicitudAdjuntoInput,
} from "../../domain/repositories/SolicitudAdjuntoRepository";
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

  async create(input: CreateSolicitudAdjuntoRecord) {
    const adjunto = await this.prisma.solicitudAdjunto.create({
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

    return SolicitudAdjuntoMapper.toDomain(adjunto);
  }

  async createMany(inputs: CreateSolicitudAdjuntoRecord[]) {
    const created = await this.prisma.$transaction(
      inputs.map((input) =>
        this.prisma.solicitudAdjunto.create({
          data: {
            adicional: input.adicional,
            archivoMimeType: input.archivoMimeType,
            archivoNombre: input.archivoNombre,
            archivoPath: input.archivoPath,
            archivoSizeBytes:
              input.archivoSizeBytes === null
                ? null
                : BigInt(input.archivoSizeBytes),
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
        }),
      ),
    );

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
