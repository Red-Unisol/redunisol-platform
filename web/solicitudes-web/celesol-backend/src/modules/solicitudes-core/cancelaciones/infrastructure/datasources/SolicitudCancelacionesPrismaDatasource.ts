import type { DbClient } from "../../../../../db/prisma";

import type {
  CreateSolicitudCancelacionRecord,
  SoftDeleteSolicitudCancelacionInput,
  UpdateSolicitudCancelacionInput,
} from "../../domain/repositories/SolicitudCancelacionRepository";
import { SolicitudCancelacionMapper } from "../mappers/SolicitudCancelacion.mapper";

const solicitudCancelacionInclude = {
  createdByUser: {
    select: {
      firstName: true,
      lastName: true,
    },
  },
};

export class SolicitudCancelacionesPrismaDatasource {
  private readonly prisma: DbClient;

  constructor(prisma: DbClient) {
    this.prisma = prisma;
  }

  async create(input: CreateSolicitudCancelacionRecord) {
    const cancelacion = await this.prisma.solicitudCancelacion.create({
      data: {
        cbu: input.cbu,
        createdBy: input.createdBy,
        cuentaADebitar: input.cuentaADebitar,
        cuentaBancaria: input.cuentaBancaria,
        id: input.cancelacionId,
        monto: input.monto,
        notas: input.notas,
        socio: input.socio,
        socioLegacyId: input.socioLegacyId,
        solicitudId: input.solicitudId,
      },
      include: solicitudCancelacionInclude,
    });

    return SolicitudCancelacionMapper.toDomain(cancelacion);
  }

  async findById(id: string) {
    const cancelacion = await this.prisma.solicitudCancelacion.findUnique({
      where: {
        id,
      },
      include: solicitudCancelacionInclude,
    });

    return cancelacion ? SolicitudCancelacionMapper.toDomain(cancelacion) : null;
  }

  async listBySolicitudId(solicitudId: string) {
    const cancelaciones = await this.prisma.solicitudCancelacion.findMany({
      where: {
        solicitudId,
      },
      orderBy: {
        createdAt: "desc",
      },
      include: solicitudCancelacionInclude,
    });

    return cancelaciones.map(SolicitudCancelacionMapper.toDomain);
  }

  async softDelete(input: SoftDeleteSolicitudCancelacionInput) {
    const cancelacion = await this.prisma.solicitudCancelacion.update({
      where: {
        id: input.cancelacionId,
      },
      data: {
        deletedAt: input.deletedAt,
        deletedBy: input.deletedBy,
      },
      include: solicitudCancelacionInclude,
    });

    return SolicitudCancelacionMapper.toDomain(cancelacion);
  }

  async update(input: UpdateSolicitudCancelacionInput) {
    const cancelacion = await this.prisma.solicitudCancelacion.update({
      where: {
        id: input.cancelacionId,
      },
      data: {
        ...(input.cuentaADebitar !== undefined && {
          cuentaADebitar: input.cuentaADebitar,
        }),
        ...(input.cbu !== undefined && { cbu: input.cbu }),
        ...(input.cuentaBancaria !== undefined && {
          cuentaBancaria: input.cuentaBancaria,
        }),
        ...(input.socio !== undefined && { socio: input.socio }),
        ...(input.socioLegacyId !== undefined && {
          socioLegacyId: input.socioLegacyId,
        }),
        ...(input.monto !== undefined && { monto: input.monto }),
        ...(input.notas !== undefined && { notas: input.notas }),
      },
      include: solicitudCancelacionInclude,
    });

    return SolicitudCancelacionMapper.toDomain(cancelacion);
  }
}
