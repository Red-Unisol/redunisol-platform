export type WorkflowTransition = {
  actionCode: string;
  actionLabel: string;
  blockedReason: string | null;
  defaultComment: string | null;
  description: string | null;
  fromStateId: string;
  id: string;
  requiresComment: boolean;
  saveAndExit: boolean;
  sortOrder: number;
  toState: {
    code: string;
    id: string;
    name: string;
    owner: {
      code: string;
      id: string;
      name: string;
    };
  };
};
