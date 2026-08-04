export type SolicitudCancelacion = {
  id: string;
  solicitudId: string;
  cuentaADebitar: string;
  cbu: string;
  cuentaBancaria: string;
  socio: string;
  socioLegacyId: string | null;
  monto: number;
  notas: string | null;
  createdBy: string | null;
  createdByName?: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
};
