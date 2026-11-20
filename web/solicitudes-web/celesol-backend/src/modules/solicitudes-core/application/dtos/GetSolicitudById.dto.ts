import type { AuthWorkflowOwner } from "../../../auth/domain/entities/User.entity";
export type GetSolicitudByIdInput = {
  id: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwners?: AuthWorkflowOwner[];
    workflowOwnerId: string | null;
  };
};
