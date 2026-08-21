import type { SolicitudCancelacion } from "../entities/SolicitudCancelacion.entity";

export type CreateSolicitudCancelacionRecord = {
  cancelacionId: string;
  solicitudId: string;
  cuentaADebitar: string;
  cbu: string;
  cuentaBancaria: string;
  socio: string;
  socioLegacyId: string | null;
  monto: number;
  notas: string | null;
  createdBy: string | null;
};

export type UpdateSolicitudCancelacionInput = {
  cancelacionId: string;
  cuentaADebitar?: string;
  cbu?: string;
  cuentaBancaria?: string;
  socio?: string;
  socioLegacyId?: string | null;
  monto?: number;
  notas?: string | null;
};

export type SoftDeleteSolicitudCancelacionInput = {
  cancelacionId: string;
  deletedAt: Date;
  deletedBy: string;
};

export type SolicitudCancelacionRepository = {
  create(
    input: CreateSolicitudCancelacionRecord,
  ): Promise<SolicitudCancelacion>;
  findById(id: string): Promise<SolicitudCancelacion | null>;
  // The repository may return deleted rows; use cases apply deletedAt filtering.
  listBySolicitudId(solicitudId: string): Promise<SolicitudCancelacion[]>;
  softDelete(
    input: SoftDeleteSolicitudCancelacionInput,
  ): Promise<SolicitudCancelacion>;
  update(
    input: UpdateSolicitudCancelacionInput,
  ): Promise<SolicitudCancelacion>;
};
