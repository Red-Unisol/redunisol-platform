export type CreateSolicitudCancelacionInput = {
  solicitudId: string;
  createdBy: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwnerId: string | null;
  };
  workflowOwnerId: string;
  cuentaADebitar: string;
  cbu: string;
  cuentaBancaria: string;
  socio: string;
  socioLegacyId?: string;
  monto: number;
  notas?: string;
};
