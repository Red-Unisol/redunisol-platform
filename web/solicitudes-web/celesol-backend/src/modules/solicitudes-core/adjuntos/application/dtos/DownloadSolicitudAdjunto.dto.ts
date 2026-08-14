export type DownloadSolicitudAdjuntoInput = {
  solicitudId: string;
  adjuntoId: string;
  currentUser: {
    id: string;
    workflowOwnerId: string | null;
  };
  workflowOwnerId?: string | null;
};
