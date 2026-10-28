export type ChangeSolicitudStateInput = {
  administrativeCorrection?: { expectedUpdatedAt: string; requestId: string };
  actionCode: string;
  comment?: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwnerId: string;
  };
  motivo?: string;
  solicitudId: string;
};
