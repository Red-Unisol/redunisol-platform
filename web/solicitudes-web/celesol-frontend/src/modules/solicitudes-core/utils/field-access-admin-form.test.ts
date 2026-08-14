/// <reference types="node" />

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FieldAccessFieldsResponse } from "@/modules/solicitudes-core/services/field-access-admin-api";
import { ApiError } from "@/shared/services/http/api-error";

import {
  buildFieldAccessRuleUpdatePayload,
  createFieldAccessRuleDraft,
  getFieldAccessAdminErrorMessage,
  validateFieldAccessRuleDraft,
  type FieldAccessRuleDraft,
} from "./field-access-admin-form";

describe("field-access-admin-form", () => {
  it("detects duplicated fields", () => {
    const issues = validateFieldAccessRuleDraft(
      {
        ...draft(),
        editableFields: ["titular.nombre", "titular.nombre"],
      },
      catalog(),
    );

    assert.equal(
      issues.some((issue) => issue.code === "duplicated_field"),
      true,
    );
  });

  it("detects duplicated groups", () => {
    const issues = validateFieldAccessRuleDraft(
      {
        ...draft(),
        editableGroups: ["garantias", "garantias"],
      },
      catalog(),
    );

    assert.equal(
      issues.some((issue) => issue.code === "duplicated_group"),
      true,
    );
  });

  it("detects blocked fields", () => {
    const issues = validateFieldAccessRuleDraft(
      {
        ...draft(),
        editableFields: ["solicitud.lineaPrestamoLegacyOid"],
      },
      catalog(),
    );

    assert.equal(
      issues.some((issue) => issue.code === "blocked_field"),
      true,
    );
  });

  it("detects fields outside the catalog", () => {
    const issues = validateFieldAccessRuleDraft(
      {
        ...draft(),
        editableFields: ["solicitud.inexistente"],
      },
      catalog(),
    );

    assert.equal(
      issues.some((issue) => issue.code === "invalid_field"),
      true,
    );
  });

  it("detects groups outside the catalog", () => {
    const issues = validateFieldAccessRuleDraft(
      {
        ...draft(),
        editableGroups: ["otro-grupo"],
      },
      catalog(),
    );

    assert.equal(
      issues.some((issue) => issue.code === "invalid_group"),
      true,
    );
  });

  it("omits both colors when there are no appearance changes", () => {
    const payload = buildFieldAccessRuleUpdatePayload(
      {
        ...draft(),
        editableFields: [
          "titular.nombre",
          "solicitud.motivo",
          "garantias.email",
        ],
        editableGroups: [],
      },
      catalog(),
      {
        backgroundColor: null,
        textColor: null,
      },
    );

    assert.deepEqual(payload, {
      active: true,
      canManageAttachments: true,
      editableFields: ["solicitud.motivo", "titular.nombre", "garantias.email"],
      editableGroups: [],
      readonlyReason: "Solo lectura por defecto",
      version: 3,
    });
    assert.equal("backgroundColor" in payload, false);
    assert.equal("textColor" in payload, false);
    assert.equal("defaultMode" in payload, false);
  });

  it("sends only backgroundColor when only background changes", () => {
    const payload = buildFieldAccessRuleUpdatePayload(
      {
        ...draft(),
        backgroundColor: "#F3F4F6",
        textColor: "#000000",
      },
      catalog(),
      {
        backgroundColor: "#FFFFFF",
        textColor: "#000000",
      },
    );

    assert.deepEqual(payload, {
      active: true,
      backgroundColor: "#F3F4F6",
      canManageAttachments: true,
      editableFields: [],
      editableGroups: [],
      readonlyReason: "Solo lectura por defecto",
      version: 3,
    });
    assert.equal("textColor" in payload, false);
  });

  it("sends only textColor when only text changes", () => {
    const payload = buildFieldAccessRuleUpdatePayload(
      {
        ...draft(),
        backgroundColor: "#FFFFFF",
        textColor: "#111827",
      },
      catalog(),
      {
        backgroundColor: "#FFFFFF",
        textColor: "#000000",
      },
    );

    assert.deepEqual(payload, {
      active: true,
      canManageAttachments: true,
      editableFields: [],
      editableGroups: [],
      readonlyReason: "Solo lectura por defecto",
      textColor: "#111827",
      version: 3,
    });
    assert.equal("backgroundColor" in payload, false);
  });

  it("sends both colors when both change", () => {
    const payload = buildFieldAccessRuleUpdatePayload(
      {
        ...draft(),
        backgroundColor: "#F3F4F6",
        textColor: "#111827",
      },
      catalog(),
      {
        backgroundColor: "#FFFFFF",
        textColor: "#000000",
      },
    );

    assert.deepEqual(payload, {
      active: true,
      backgroundColor: "#F3F4F6",
      canManageAttachments: true,
      editableFields: [],
      editableGroups: [],
      readonlyReason: "Solo lectura por defecto",
      textColor: "#111827",
      version: 3,
    });
  });

  it("sends backgroundColor null when only background is cleared", () => {
    const payload = buildFieldAccessRuleUpdatePayload(
      {
        ...draft(),
        backgroundColor: "",
        textColor: "#000000",
      },
      catalog(),
      {
        backgroundColor: "#FFFFFF",
        textColor: "#000000",
      },
    );

    assert.deepEqual(payload, {
      active: true,
      backgroundColor: null,
      canManageAttachments: true,
      editableFields: [],
      editableGroups: [],
      readonlyReason: "Solo lectura por defecto",
      version: 3,
    });
    assert.equal("textColor" in payload, false);
  });

  it("sends textColor null when only text is cleared", () => {
    const payload = buildFieldAccessRuleUpdatePayload(
      {
        ...draft(),
        backgroundColor: "#FFFFFF",
        textColor: "",
      },
      catalog(),
      {
        backgroundColor: "#FFFFFF",
        textColor: "#000000",
      },
    );

    assert.deepEqual(payload, {
      active: true,
      canManageAttachments: true,
      editableFields: [],
      editableGroups: [],
      readonlyReason: "Solo lectura por defecto",
      textColor: null,
      version: 3,
    });
    assert.equal("backgroundColor" in payload, false);
  });

  it("sends both colors as null when both are cleared", () => {
    const payload = buildFieldAccessRuleUpdatePayload(draft(), catalog(), {
      backgroundColor: "#FFFFFF",
      textColor: "#000000",
    });

    assert.deepEqual(payload, {
      active: true,
      backgroundColor: null,
      canManageAttachments: true,
      editableFields: [],
      editableGroups: [],
      readonlyReason: "Solo lectura por defecto",
      textColor: null,
      version: 3,
    });
  });

  it("maps legacy garantias group into editableFields in the draft", () => {
    const nextDraft = createFieldAccessRuleDraft(
      {
        resolvedFieldAccess: {
          defaultMode: "readonly",
          editableFields: [],
          editableGroups: ["garantias"],
        },
        resolvedAppearance: {
          backgroundColor: "#FF7F7F",
          textColor: "#000000",
        },
        rule: {
          active: true,
          backgroundColor: "#FF7F7F",
          canManageAttachments: true,
          defaultMode: "readonly",
          editableFields: [],
          editableGroups: ["garantias"],
          readonlyReason: null,
          textColor: "#000000",
          updatedAt: "",
          updatedBy: null,
          version: 1,
          workflowStateId: "state-1",
        },
        source: "persisted",
        state: {
          code: "CargaVendedor",
          id: "state-1",
          isActive: true,
          isInitial: false,
          isTerminal: false,
          name: "Carga vendedor",
          ownerCode: "owner",
          ownerId: "owner-1",
          ownerName: "Owner",
        },
      },
      catalog(),
    );

    assert.deepEqual(nextDraft.editableFields, ["garantias.email"]);
    assert.deepEqual(nextDraft.editableGroups, []);
    assert.equal(nextDraft.backgroundColor, "#FF7F7F");
    assert.equal(nextDraft.canManageAttachments, true);
    assert.equal(nextDraft.textColor, "#000000");
  });

  it("includes canManageAttachments in the payload when toggled off", () => {
    const payload = buildFieldAccessRuleUpdatePayload(
      {
        ...draft(),
        canManageAttachments: false,
      },
      catalog(),
      {
        backgroundColor: null,
        textColor: null,
      },
    );

    assert.equal(payload.canManageAttachments, false);
  });

  it("maps version conflict backend errors", () => {
    const error = new ApiError("FIELD_ACCESS_RULE_VERSION_CONFLICT", 409);

    assert.equal(
      getFieldAccessAdminErrorMessage(error),
      "Otra persona modific\\u00f3 esta configuraci\\u00f3n mientras la estabas editando. Recarga la regla antes de guardar nuevamente.",
    );
  });
});

function draft(): FieldAccessRuleDraft {
  return {
    active: true,
    backgroundColor: "",
    canManageAttachments: true,
    editableFields: [],
    editableGroups: [],
    readonlyReason: "Solo lectura por defecto",
    stateCode: "CargaVendedor",
    textColor: "",
    version: 3,
  };
}

function catalog(): FieldAccessFieldsResponse {
  return {
    allowedDefaultModes: ["readonly"],
    blockedFields: [
      "solicitud.lineaPrestamoLegacyOid",
      "solicitud.ejecutivoSolicitud",
    ],
    defaultReadonlyReason:
      "La solicitud no admite edici\\u00f3n de datos en su estado actual.",
    fieldCatalog: {
      conyuge: ["conyuge.nombre"],
      datosLaborales: ["datosLaborales.empleador"],
      garantias: ["garantias.email"],
      solicitud: [
        "solicitud.motivo",
        "solicitud.observaciones",
        "solicitud.linkFirmaDigital",
        "solicitud.firmaDigitalmente",
      ],
      titular: ["titular.apellidoDenominacion", "titular.nombre"],
    },
    groupCatalog: [],
    states: [],
  };
}
