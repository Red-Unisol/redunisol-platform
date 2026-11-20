import type { AuthWorkflowOwner } from "../../../../auth/domain/entities/User.entity";
export type DeleteSolicitudAdjuntoInput = {
  solicitudId: string;
  adjuntoId: string;
  deletedBy: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwners?: AuthWorkflowOwner[];
    workflowOwnerId: string | null;
  };
  workflowOwnerId: string;
  deleteReason?: string;
};
