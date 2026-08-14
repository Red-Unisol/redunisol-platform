export type DeleteSolicitudAdjuntoInput = {
  solicitudId: string;
  adjuntoId: string;
  deletedBy: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwnerId: string | null;
  };
  workflowOwnerId: string;
  deleteReason?: string;
};
