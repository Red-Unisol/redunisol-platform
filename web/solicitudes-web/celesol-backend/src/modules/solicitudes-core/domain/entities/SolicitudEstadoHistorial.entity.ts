export type SolicitudEstadoHistorial = {
  actionCode: string | null;
  actionLabel: string | null;
  changedAt: Date;
  changedBy: string | null;
  changedByFullName: string | null;
  comentario: string | null;
  estadoAnterior: {
    code: string | null;
    name: string | null;
    ownerCode: string | null;
    ownerName: string | null;
  };
  estadoNuevo: {
    code: string;
    name: string;
    ownerCode: string | null;
    ownerName: string | null;
  };
  id: string;
  motivo: string | null;
  solicitudId: string;
};

