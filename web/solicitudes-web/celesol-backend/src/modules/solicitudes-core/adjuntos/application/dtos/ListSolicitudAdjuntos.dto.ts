export type ListSolicitudAdjuntosInput = {
  solicitudId: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwnerId: string | null;
  };
  workflowOwnerId?: string | null;
};
