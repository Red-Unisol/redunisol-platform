import type { AuthWorkflowOwner } from "../../../auth/domain/entities/User.entity";
export type ChangeSolicitudStateInput = {
  administrativeCorrection?: { expectedUpdatedAt: string; requestId: string };
  actionCode: string;
  comment?: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwners?: AuthWorkflowOwner[];
    workflowOwnerId: string;
  };
  motivo?: string;
  solicitudId: string;
};
