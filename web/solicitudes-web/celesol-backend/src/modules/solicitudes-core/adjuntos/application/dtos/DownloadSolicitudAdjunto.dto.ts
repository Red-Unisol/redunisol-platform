export type DownloadSolicitudAdjuntoInput = {
  solicitudId: string;
  adjuntoId: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwnerId: string | null;
  };
  workflowOwnerId?: string | null;
};
