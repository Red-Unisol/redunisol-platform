import type { AuthWorkflowOwner } from "../../../../auth/domain/entities/User.entity";
export type ListSolicitudAdjuntosInput = {
  solicitudId: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwners?: AuthWorkflowOwner[];
    workflowOwnerId: string | null;
  };
  workflowOwnerId?: string | null;
};
