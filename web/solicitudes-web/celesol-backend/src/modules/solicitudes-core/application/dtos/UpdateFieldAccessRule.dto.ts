export type UpdateFieldAccessRuleInput = {
  active: boolean;
  backgroundColor?: string | null;
  canManageAttachments: boolean;
  currentUserId: string;
  editableFields: string[];
  editableGroups: string[];
  readonlyReason?: string | null;
  stateCode: string;
  textColor?: string | null;
  version: number;
};
