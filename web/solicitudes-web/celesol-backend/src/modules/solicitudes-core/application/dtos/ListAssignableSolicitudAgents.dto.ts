export type ListAssignableSolicitudAgentsInput = {
  solicitudId: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwnerId: string | null;
  };
};

export type AssignableSolicitudAgent = {
  id: string;
  fullName: string | null;
  email: string | null;
};
