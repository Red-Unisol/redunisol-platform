import type { AuthWorkflowOwner } from "../../../auth/domain/entities/User.entity";
export type ListAssignableSolicitudAgentsInput = {
  solicitudId: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwners?: AuthWorkflowOwner[];
    workflowOwnerId: string | null;
  };
};

export type AssignableSolicitudAgent = {
  id: string;
  fullName: string | null;
  email: string | null;
};
