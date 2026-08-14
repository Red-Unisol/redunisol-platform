export type AssignSolicitudToSelfInput = {
  solicitudId: string;
  currentUser: {
    id: string;
    isAnalista?: boolean;
    isSystemAdmin?: boolean;
    workflowOwnerId: string | null;
  };
};
