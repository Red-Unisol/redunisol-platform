import type { AuthWorkflowOwner } from "../../../../auth/domain/entities/User.entity";
export type DeleteSolicitudCancelacionInput = {
  solicitudId: string;
  cancelacionId: string;
  deletedBy: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwners?: AuthWorkflowOwner[];
    workflowOwnerId: string | null;
  };
  workflowOwnerId: string;
};
