import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWorkflowTransitionDraft,
  buildWorkflowTransitionUpdateRequest,
  isWorkflowTransitionDraftDirty,
} from "./workflow-transition-admin-form";

describe("workflow-transition-admin-form", () => {
  const baseTransition = {
    actionCode: "enviar",
    actionLabel: "Enviar",
    defaultComment: "Pase a riesgo",
    description: "Descripción base",
    id: "tr-enviar",
    isActive: true,
    requiresComment: false,
    sortOrder: 10,
    toState: {
      code: "RevisionRiesgo",
      id: "state-riesgo",
      name: "Revisión de riesgo",
      owner: {
        code: "RIESGO",
        id: "owner-riesgo",
        name: "Riesgo",
      },
    },
    updatedAt: "2026-06-11T10:00:00.000Z",
  };

  it("builds an update payload with only allowed fields", () => {
    const draft = buildWorkflowTransitionDraft(baseTransition);

    draft.actionLabel = "  Enviar solicitud  ";
    draft.defaultComment = "  Pase a riesgo  ";
    draft.description = "   ";
    draft.requiresComment = true;
    draft.sortOrder = "25";

    assert.deepEqual(buildWorkflowTransitionUpdateRequest(draft), {
      actionLabel: "  Enviar solicitud  ",
      defaultComment: "Pase a riesgo",
      description: null,
      requiresComment: true,
      sortOrder: 25,
      updatedAt: "2026-06-11T10:00:00.000Z",
    });
  });

  it("marks a row as dirty only when allowed editable fields change", () => {
    const draft = buildWorkflowTransitionDraft(baseTransition);

    assert.equal(isWorkflowTransitionDraftDirty(draft, baseTransition), false);

    draft.requiresComment = true;

    assert.equal(isWorkflowTransitionDraftDirty(draft, baseTransition), true);
  });
});
