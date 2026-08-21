import type { SolicitudAdjunto } from "../entities/SolicitudAdjunto.entity";

export type CreateSolicitudAdjuntoRecord = {
  adjuntoId: string;
  solicitudId: string;
  archivoNombre: string | null;
  archivoPath: string | null;
  archivoMimeType: string | null;
  archivoSizeBytes: number | null;
  storageBucket: string | null;
  tipoAdjunto: string | null;
  estadoAdjunto: string | null;
  descripcion: string | null;
  adicional: string | null;
  comentario: string | null;
  nroDocumento: string | null;
  restringido: boolean;
  uploadedBy: string | null;
};

export type SoftDeleteSolicitudAdjuntoInput = {
  adjuntoId: string;
  deletedAt: Date;
  deletedBy: string;
  deleteReason: string | null;
};

export type UpdateSolicitudAdjuntoInput = {
  adjuntoId: string;
  tipoAdjunto?: string;
  descripcion?: string;
  adicional?: string;
  comentario?: string;
  nroDocumento?: string;
  restringido?: boolean;
};

export type SolicitudAdjuntoRepository = {
  create(input: CreateSolicitudAdjuntoRecord): Promise<SolicitudAdjunto>;
  createMany(inputs: CreateSolicitudAdjuntoRecord[]): Promise<SolicitudAdjunto[]>;
  findById(id: string): Promise<SolicitudAdjunto | null>;
  // The repository may return deleted rows; use cases apply deletedAt filtering.
  listBySolicitudId(solicitudId: string): Promise<SolicitudAdjunto[]>;
  softDelete(input: SoftDeleteSolicitudAdjuntoInput): Promise<SolicitudAdjunto>;
  update(input: UpdateSolicitudAdjuntoInput): Promise<SolicitudAdjunto>;
};
