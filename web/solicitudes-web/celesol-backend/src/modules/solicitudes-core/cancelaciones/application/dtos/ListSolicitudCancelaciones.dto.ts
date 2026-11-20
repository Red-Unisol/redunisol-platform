import type { AuthWorkflowOwner } from "../../../../auth/domain/entities/User.entity";
export type ListSolicitudCancelacionesInput = {
  solicitudId: string;
  currentUser: {
    id: string;
    workflowOwners?: AuthWorkflowOwner[];
    workflowOwnerId: string | null;
  };
};
