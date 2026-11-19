import type { AuthWorkflowOwner } from "../../../../auth/domain/entities/User.entity";
export type UpdateSolicitudCancelacionInput = {
  solicitudId: string;
  cancelacionId: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwners?: AuthWorkflowOwner[];
    workflowOwnerId: string | null;
  };
  workflowOwnerId: string;
  cuentaADebitar?: string;
  cbu?: string;
  cuentaBancaria?: string;
  socio?: string;
  socioLegacyId?: string;
  monto?: number;
  notas?: string;
};
