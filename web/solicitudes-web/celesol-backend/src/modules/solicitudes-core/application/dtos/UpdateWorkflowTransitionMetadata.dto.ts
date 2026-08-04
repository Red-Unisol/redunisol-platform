export type UpdateWorkflowTransitionMetadataInput = {
  actionLabel: string;
  currentUserId: string;
  defaultComment: string | null;
  description: string | null;
  requiresComment: boolean;
  sortOrder: number;
  transitionId: string;
  updatedAt: string;
};
