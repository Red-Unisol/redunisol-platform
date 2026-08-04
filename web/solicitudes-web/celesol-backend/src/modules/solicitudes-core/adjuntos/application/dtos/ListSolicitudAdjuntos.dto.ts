export type ListSolicitudAdjuntosInput = {
  solicitudId: string;
  currentUser: {
    id: string;
    workflowOwnerId: string | null;
  };
  workflowOwnerId?: string | null;
};
