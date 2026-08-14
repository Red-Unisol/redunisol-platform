export type ListSolicitudCancelacionesInput = {
  solicitudId: string;
  currentUser: {
    id: string;
    workflowOwnerId: string | null;
  };
};
