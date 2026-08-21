export type CreatePrestamoLegacyInput = {
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwnerId: string;
  };
  solicitudId: string;
};
