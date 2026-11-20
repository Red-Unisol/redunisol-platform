import type { AuthWorkflowOwner } from "../../../auth/domain/entities/User.entity";
export type AssignSolicitudToSelfInput = {
  solicitudId: string;
  currentUser: {
    id: string;
    isAnalista?: boolean;
    isSystemAdmin?: boolean;
    workflowOwners?: AuthWorkflowOwner[];
    workflowOwnerId: string | null;
  };
};
