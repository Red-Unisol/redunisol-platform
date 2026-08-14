export type ListSolicitudHistoryInput = {
  solicitudId: string;
  currentUser: {
    id: string;
    workflowOwnerId: string | null;
  };
};
