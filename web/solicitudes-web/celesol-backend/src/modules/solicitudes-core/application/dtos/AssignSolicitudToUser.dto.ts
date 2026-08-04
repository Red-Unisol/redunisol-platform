export type AssignSolicitudToUserInput = {
  solicitudId: string;
  targetUserId: string;
  currentUser: {
    id: string;
    isAnalista?: boolean;
    isSystemAdmin?: boolean;
    workflowOwnerId: string | null;
  };
};
