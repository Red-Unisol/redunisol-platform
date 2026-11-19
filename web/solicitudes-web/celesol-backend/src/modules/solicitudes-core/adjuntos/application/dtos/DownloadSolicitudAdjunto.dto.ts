import type { AuthWorkflowOwner } from "../../../../auth/domain/entities/User.entity";
export type DownloadSolicitudAdjuntoInput = {
  solicitudId: string;
  adjuntoId: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwners?: AuthWorkflowOwner[];
    workflowOwnerId: string | null;
  };
  workflowOwnerId?: string | null;
};
