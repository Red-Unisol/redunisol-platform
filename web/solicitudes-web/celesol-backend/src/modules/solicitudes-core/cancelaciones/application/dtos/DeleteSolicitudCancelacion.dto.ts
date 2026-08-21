export type DeleteSolicitudCancelacionInput = {
  solicitudId: string;
  cancelacionId: string;
  deletedBy: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwnerId: string | null;
  };
  workflowOwnerId: string;
};
