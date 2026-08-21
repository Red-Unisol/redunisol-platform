export type ChangeSolicitudStateInput = {
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
