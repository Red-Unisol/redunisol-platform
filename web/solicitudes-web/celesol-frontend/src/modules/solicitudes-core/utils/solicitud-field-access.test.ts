/// <reference types="node" />

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SolicitudCoreCapabilitiesResponse } from "@/modules/solicitudes/types/solicitudes-core";
import {
  areAllGarantiasFieldsEditable,
  GARANTIAS_FIELD_KEYS,
  hasAnyGarantiasFieldEditable,
  isFieldEditable,
  isGroupEditable,
} from "./solicitud-field-access";

describe("solicitud-field-access", () => {
  it("returns readonly when fieldAccess is absent", () => {
    assert.equal(isFieldEditable(undefined, "solicitud.motivo"), false);
    assert.equal(isGroupEditable(undefined, "garantias"), false);
  });

  it("returns true only for fields present in editableFields", () => {
    const capabilities = capabilitiesWithFieldAccess();

    assert.equal(isFieldEditable(capabilities, "solicitud.motivo"), true);
    assert.equal(
      isFieldEditable(capabilities, "solicitud.linkFirmaDigital"),
      true,
    );
    assert.equal(
      isFieldEditable(capabilities, "solicitud.firmaDigitalmente"),
      true,
    );
    assert.equal(
      isFieldEditable(capabilities, "solicitud.fechaPrimerVencimiento"),
      false,
    );
  });

  it("returns true only for groups present in editableGroups", () => {
    const capabilities = capabilitiesWithLegacyGarantiasGroup();

    assert.equal(isGroupEditable(capabilities, "garantias"), true);
    assert.equal(isGroupEditable(capabilities, "titular"), false);
  });

  it("treats legacy garantias group as editable for garantias.* fields", () => {
    const capabilities = capabilitiesWithLegacyGarantiasGroup();

    assert.equal(isFieldEditable(capabilities, "garantias.email"), true);
    assert.equal(hasAnyGarantiasFieldEditable(capabilities), true);
    assert.equal(areAllGarantiasFieldsEditable(capabilities), true);
  });

  it("requires every guarantees key for the full editable check", () => {
    const capabilities = capabilitiesWithFieldAccess();

    assert.equal(hasAnyGarantiasFieldEditable(capabilities), true);
    assert.equal(areAllGarantiasFieldsEditable(capabilities), false);
    assert.equal(isFieldEditable(capabilities, GARANTIAS_FIELD_KEYS[0]), false);
  });
});

function capabilitiesWithFieldAccess(): SolicitudCoreCapabilitiesResponse {
  return {
    canChangeState: false,
    canDeleteAdjuntos: false,
    canDownloadAdjuntos: false,
    canManageCancelaciones: false,
    canEdit: true,
    canUploadAdjuntos: false,
    canView: true,
    canViewHistory: true,
    fieldAccess: {
      defaultMode: "readonly",
      editableFields: [
        "solicitud.motivo",
        "solicitud.linkFirmaDigital",
        "solicitud.firmaDigitalmente",
        "titular.nombre",
        "garantias.email",
      ],
      editableGroups: [],
    },
  };
}

function capabilitiesWithLegacyGarantiasGroup(): SolicitudCoreCapabilitiesResponse {
  return {
    canChangeState: false,
    canDeleteAdjuntos: false,
    canDownloadAdjuntos: false,
    canManageCancelaciones: false,
    canEdit: true,
    canUploadAdjuntos: false,
    canView: true,
    canViewHistory: true,
    fieldAccess: {
      defaultMode: "readonly",
      editableFields: [],
      editableGroups: ["garantias"],
    },
  };
}
