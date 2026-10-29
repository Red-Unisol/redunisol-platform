import type { Prisma } from "@prisma/client";
import { assertNoLoanReplacementPending } from "../../../domain/workflow/AdministrativeCorrection";
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

  private editableWrite<T>(ids: { solicitudId?: string; cancelacionId?: string }, write: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(async tx => {
      const id = ids.solicitudId ?? (await tx.solicitudCancelacion.findUnique({ where: { id: ids.cancelacionId } }))?.solicitudId;
      if (id) {
        await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
        const s = await tx.solicitud.findUnique({ where: { id }, select: { administrativeCoreControl: true } });
        if (s) assertNoLoanReplacementPending(s);
      }
      const result = await write(tx);
      // A cancellation changes the loan input and must invalidate forms opened
      // against the previous parent version, even before a replacement starts.
      if (id) await tx.solicitud.update({ where: { id }, data: { updatedAt: new Date() } });
      return result;
    });
  }

  async create(input: CreateSolicitudCancelacionRecord) {
    const cancelacion = await this.editableWrite({ solicitudId: input.solicitudId }, tx => tx.solicitudCancelacion.create({
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
    }));

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
    const cancelacion = await this.editableWrite({ cancelacionId: input.cancelacionId }, tx => tx.solicitudCancelacion.update({
      where: {
        id: input.cancelacionId,
      },
      data: {
        deletedAt: input.deletedAt,
        deletedBy: input.deletedBy,
      },
      include: solicitudCancelacionInclude,
    }));

    return SolicitudCancelacionMapper.toDomain(cancelacion);
  }

  async update(input: UpdateSolicitudCancelacionInput) {
    const cancelacion = await this.editableWrite({ cancelacionId: input.cancelacionId }, tx => tx.solicitudCancelacion.update({
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
    }));

    return SolicitudCancelacionMapper.toDomain(cancelacion);
  }
}
