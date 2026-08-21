import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FieldAccessRuleBlockedFieldError,
  FieldAccessRuleDuplicatedFieldError,
  FieldAccessRuleDuplicatedGroupError,
  FieldAccessRuleInvalidFieldError,
  FieldAccessRuleInvalidGroupError,
} from "../../domain/solicitudes-core-errors";
import { normalizeFieldAccessRule } from "./SolicitudFieldAccessRuleValidation";

describe("normalizeFieldAccessRule", () => {
  function input(
    overrides: Partial<Parameters<typeof normalizeFieldAccessRule>[0]> = {},
  ) {
    return {
      canManageAttachments: true,
      editableFields: [],
      editableGroups: [],
      ...overrides,
    };
  }

  it("accepts a valid rule and sorts values by the official catalog order", () => {
    const normalized = normalizeFieldAccessRule(input({
      active: true,
      editableFields: [
        "titular.nombre",
        "garantias.email",
        "solicitud.motivo",
        "titular.apellidoDenominacion",
      ],
      editableGroups: ["garantias"],
      readonlyReason: "  ",
    }));

    assert.deepEqual(normalized, {
      active: true,
      backgroundColor: null,
      canManageAttachments: true,
      defaultMode: "readonly",
      editableFields: [
        "solicitud.motivo",
        "titular.apellidoDenominacion",
        "titular.nombre",
        "garantias.email",
      ],
      editableGroups: ["garantias"],
      readonlyReason: null,
      textColor: null,
    });
  });

  it("accepts canonical garantias fields", () => {
    const normalized = normalizeFieldAccessRule(input({
      editableFields: ["garantias.email", "garantias.cuit"],
    }));

    assert.deepEqual(normalized.editableFields, [
      "garantias.cuit",
      "garantias.email",
    ]);
  });

  it("accepts firma digital fields in solicitud", () => {
    const normalized = normalizeFieldAccessRule(input({
      editableFields: [
        "solicitud.linkFirmaDigital",
        "solicitud.firmaDigitalmente",
      ],
    }));

    assert.deepEqual(normalized.editableFields, [
      "solicitud.firmaDigitalmente",
      "solicitud.linkFirmaDigital",
    ]);
  });

  it("rejects unknown fields", () => {
    assert.throws(
      () =>
        normalizeFieldAccessRule(input({
          editableFields: ["solicitud.noExiste"],
        })),
      FieldAccessRuleInvalidFieldError,
    );
  });

  it("rejects malformed garantias indexed fields", () => {
    assert.throws(
      () =>
        normalizeFieldAccessRule(input({
          editableFields: ["garantias[0].email"],
        })),
      FieldAccessRuleInvalidFieldError,
    );
  });

  it("rejects unknown groups", () => {
    assert.throws(
      () =>
        normalizeFieldAccessRule(input({
          editableGroups: ["solicitud" as never],
        })),
      FieldAccessRuleInvalidGroupError,
    );
  });

  it("rejects protected line field", () => {
    assert.throws(
      () =>
        normalizeFieldAccessRule(input({
          editableFields: ["solicitud.lineaPrestamoLegacyOid"],
        })),
      FieldAccessRuleBlockedFieldError,
    );
  });

  it("rejects protected ejecutivo field", () => {
    assert.throws(
      () =>
        normalizeFieldAccessRule(input({
          editableFields: ["solicitud.ejecutivoSolicitud"],
        })),
      FieldAccessRuleBlockedFieldError,
    );
  });

  it("rejects duplicated fields", () => {
    assert.throws(
      () =>
        normalizeFieldAccessRule(input({
          editableFields: ["solicitud.motivo", "solicitud.motivo"],
        })),
      FieldAccessRuleDuplicatedFieldError,
    );
  });

  it("rejects duplicated groups", () => {
    assert.throws(
      () =>
        normalizeFieldAccessRule(input({
          editableGroups: ["garantias", "garantias"],
        })),
      FieldAccessRuleDuplicatedGroupError,
    );
  });

  it("defaults empty active rules to readonly with the standard reason", () => {
    const normalized = normalizeFieldAccessRule(input());

    assert.deepEqual(normalized, {
      active: true,
      backgroundColor: null,
      canManageAttachments: true,
      defaultMode: "readonly",
      editableFields: [],
      editableGroups: [],
      readonlyReason:
        "La solicitud no admite edicion de datos en su estado actual.",
      textColor: null,
    });
  });

  it("accepts a complete appearance and normalizes it to uppercase", () => {
    const normalized = normalizeFieldAccessRule(input({
      backgroundColor: "#ff7f7f",
      textColor: "#000000",
    }));

    assert.equal(normalized.backgroundColor, "#FF7F7F");
    assert.equal(normalized.textColor, "#000000");
  });

  it("accepts appearance with only backgroundColor", () => {
    const normalized = normalizeFieldAccessRule(input({
      backgroundColor: "#ff7f7f",
      textColor: null,
    }));

    assert.equal(normalized.backgroundColor, "#FF7F7F");
    assert.equal(normalized.textColor, null);
  });

  it("accepts appearance with only textColor", () => {
    const normalized = normalizeFieldAccessRule(input({
      backgroundColor: null,
      textColor: "#111827",
    }));

    assert.equal(normalized.backgroundColor, null);
    assert.equal(normalized.textColor, "#111827");
  });

  it("accepts appearance when both colors are null", () => {
    const normalized = normalizeFieldAccessRule(input({
      backgroundColor: null,
      textColor: null,
    }));

    assert.equal(normalized.backgroundColor, null);
    assert.equal(normalized.textColor, null);
  });

  it("rejects invalid backgroundColor", () => {
    assert.throws(
      () =>
        normalizeFieldAccessRule(input({
          backgroundColor: "rgb(255,0,0)",
          textColor: "#000000",
        })),
      /FIELD_ACCESS_RULE_INVALID_APPEARANCE_COLOR/,
    );
  });

  it("rejects invalid textColor", () => {
    assert.throws(
      () =>
        normalizeFieldAccessRule(input({
          backgroundColor: "#FF7F7F",
          textColor: "rgb(0,0,0)",
        })),
      /FIELD_ACCESS_RULE_INVALID_APPEARANCE_COLOR/,
    );
  });
});
