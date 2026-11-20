import type { AuthWorkflowOwner } from "../../../auth/domain/entities/User.entity";
export type ListSolicitudTransitionsInput = {
  isSystemAdmin?: boolean;
  solicitudId: string;
  workflowOwners?: AuthWorkflowOwner[];
  workflowOwnerId: string;
};
