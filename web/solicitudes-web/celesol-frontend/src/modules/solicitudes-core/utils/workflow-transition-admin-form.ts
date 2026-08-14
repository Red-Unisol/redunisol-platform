import type {
  UpdateWorkflowTransitionRequest,
  WorkflowTransitionAdminRecord,
} from "@/modules/solicitudes-core/services/workflow-transition-admin-api";

export type WorkflowTransitionDraft = {
  actionLabel: string;
  defaultComment: string;
  description: string;
  requiresComment: boolean;
  sortOrder: string;
  updatedAt: string;
};

export function buildWorkflowTransitionDraft(
  transition: WorkflowTransitionAdminRecord,
): WorkflowTransitionDraft {
  return {
    actionLabel: transition.actionLabel,
    defaultComment: transition.defaultComment ?? "",
    description: transition.description ?? "",
    requiresComment: transition.requiresComment,
    sortOrder: String(transition.sortOrder),
    updatedAt: transition.updatedAt,
  };
}

export function buildWorkflowTransitionDraftMap(
  transitions: WorkflowTransitionAdminRecord[],
) {
  return Object.fromEntries(
    transitions.map((transition) => [
      transition.id,
      buildWorkflowTransitionDraft(transition),
    ]),
  );
}

export function normalizeOptionalText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function validateWorkflowTransitionDraft(
  draft: WorkflowTransitionDraft,
): string | null {
  if (draft.actionLabel.trim().length === 0) {
    return "El nombre visible no puede estar vacío.";
  }

  if (!/^\d+$/.test(draft.sortOrder.trim())) {
    return "El orden debe ser un número entero igual o mayor a cero.";
  }

  return null;
}

export function buildWorkflowTransitionUpdateRequest(
  draft: WorkflowTransitionDraft,
): UpdateWorkflowTransitionRequest {
  return {
    actionLabel: draft.actionLabel,
    defaultComment: normalizeOptionalText(draft.defaultComment),
    description: normalizeOptionalText(draft.description),
    requiresComment: draft.requiresComment,
    sortOrder: Number.parseInt(draft.sortOrder, 10),
    updatedAt: draft.updatedAt,
  };
}

export function isWorkflowTransitionDraftDirty(
  draft: WorkflowTransitionDraft,
  transition: WorkflowTransitionAdminRecord,
) {
  return (
    draft.actionLabel !== transition.actionLabel ||
    normalizeOptionalText(draft.description) !== transition.description ||
    normalizeOptionalText(draft.defaultComment) !== transition.defaultComment ||
    draft.requiresComment !== transition.requiresComment ||
    draft.sortOrder !== String(transition.sortOrder)
  );
}
