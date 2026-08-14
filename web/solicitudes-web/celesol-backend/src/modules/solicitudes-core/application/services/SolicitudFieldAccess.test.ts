import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import type { UpdateSolicitudInput } from "../dtos/UpdateSolicitud.dto";
import type {
  SolicitudCore,
  SolicitudFieldKey,
} from "../../domain/entities/SolicitudCore.entity";
import {
  buildFieldAccessAppearanceFromRuleRecord,
  buildFieldAccessFromRuleRecord,
  buildSolicitudFieldAccess,
  buildSolicitudAppearance,
  CONYUGE_EDITABLE_FIELDS,
  EDITABLE_FIELDS,
  EDITABLE_GROUPS,
  GARANTIAS_EDITABLE_FIELDS,
  extractSolicitudPatchAccessTargets,
  LEGACY_EDITABLE_GROUPS,
  READONLY_REASON,
} from "./SolicitudFieldAccess";

describe("SolicitudFieldAccess", () => {
  it("returns the expected allowlist for CargaVendedor", () => {
    const fieldAccess = buildSolicitudFieldAccess(
      solicitudCore({ estadoActual: state("CargaVendedor") }),
    );

    assert.equal(fieldAccess.defaultMode, "readonly");
    assert.deepEqual(fieldAccess.editableFields, [...EDITABLE_FIELDS]);
    assert.deepEqual(fieldAccess.editableGroups, []);
    assert.equal(fieldAccess.readonlyReason, undefined);
  });

  it("returns the same allowlist for Revisar", () => {
    const fieldAccess = buildSolicitudFieldAccess(
      solicitudCore({ estadoActual: state("Revisar") }),
    );

    assert.deepEqual(fieldAccess.editableFields, [...EDITABLE_FIELDS]);
    assert.deepEqual(fieldAccess.editableGroups, []);
  });

  it("returns readonly for non editable states", () => {
    for (const stateCode of [
      "RevisionRiesgo",
      "Confirmada",
      "Liquidada",
      "VerificarFirmaYDocumentacion",
      "Transferir",
      "Desestimada",
      "Rechazada",
      "Vencida",
      "Motor",
      "EstadoDesconocido",
    ]) {
      const fieldAccess = buildSolicitudFieldAccess(
        solicitudCore({ estadoActual: state(stateCode) }),
      );

      assert.equal(fieldAccess.defaultMode, "readonly");
      assert.deepEqual(fieldAccess.editableFields, []);
      assert.deepEqual(fieldAccess.editableGroups, []);
      assert.equal(
        fieldAccess.readonlyReason,
        "La solicitud no admite edicion de datos en su estado actual.",
      );
    }
  });

  it("returns the full editable field access for a system admin regardless of workflow state", () => {
    for (const stateCode of ["RevisionRiesgo", "Confirmada", "Transferir"]) {
      const fieldAccess = buildSolicitudFieldAccess(
        solicitudCore({ estadoActual: state(stateCode) }),
        undefined,
        true,
      );

      assert.deepEqual(fieldAccess, {
        defaultMode: "readonly",
        editableFields: [...EDITABLE_FIELDS],
        editableGroups: [...EDITABLE_GROUPS, ...LEGACY_EDITABLE_GROUPS],
      });
    }
  });

  it("returns the full editable field access for an analista regardless of workflow state", () => {
    for (const stateCode of ["RevisionRiesgo", "Confirmada", "Transferir"]) {
      const fieldAccess = buildSolicitudFieldAccess(
        solicitudCore({ estadoActual: state(stateCode) }),
        undefined,
        false,
        true,
      );

      assert.deepEqual(fieldAccess, {
        defaultMode: "readonly",
        editableFields: [...EDITABLE_FIELDS],
        editableGroups: [...EDITABLE_GROUPS, ...LEGACY_EDITABLE_GROUPS],
      });
    }
  });

  it("returns the full editable field access for an analista even when a persisted rule would be readonly", () => {
    const fieldAccess = buildSolicitudFieldAccess(
      solicitudCore({ estadoActual: state("Confirmada") }),
      {
        active: true,
        backgroundColor: null,
        canManageAttachments: false,
        defaultMode: "readonly",
        editableFields: [],
        editableGroups: [],
        readonlyReason: "No editable en este estado.",
        textColor: null,
        workflowStateId: "state-1",
      },
      false,
      true,
    );

    assert.deepEqual(fieldAccess, {
      defaultMode: "readonly",
      editableFields: [...EDITABLE_FIELDS],
      editableGroups: [...EDITABLE_GROUPS, ...LEGACY_EDITABLE_GROUPS],
    });
  });

  it("returns null appearance for an analista", () => {
    const appearance = buildSolicitudAppearance(
      solicitudCore({ estadoActual: state("Confirmada") }),
      undefined,
      false,
      true,
    );

    assert.deepEqual(appearance, { backgroundColor: null, textColor: null });
  });

  it("still rejects blocked fields in a patch even when the field access allows every editable field", () => {
    const fieldAccess = buildSolicitudFieldAccess(
      solicitudCore({ estadoActual: state("Confirmada") }),
      undefined,
      false,
      true,
    );

    const targets = extractSolicitudPatchAccessTargets({
      currentUser: { id: "riesgo-1", isAnalista: true, workflowOwnerId: "owner-riesgo" },
      createdBy: "riesgo-1",
      createdByLegacyUser: "RIESGO1",
      id: "sol-1",
      solicitud: { ejecutivoSolicitud: "someone-else" },
    } as UpdateSolicitudInput);

    assert.deepEqual(targets.blockedFields, ["solicitud.ejecutivoSolicitud"]);
    assert.equal(fieldAccess.editableFields.includes("solicitud.ejecutivoSolicitud" as SolicitudFieldKey), false);
  });

  it("returns the full editable field access for a system admin even when a persisted rule would be readonly", () => {
    const fieldAccess = buildSolicitudFieldAccess(
      solicitudCore({ estadoActual: state("Confirmada") }),
      {
        active: true,
        backgroundColor: "#FF7F7F",
        canManageAttachments: true,
        defaultMode: "readonly",
        editableFields: [],
        editableGroups: [],
        readonlyReason: READONLY_REASON,
        textColor: "#000000",
        workflowStateId: "state-1",
      },
      true,
    );

    assert.deepEqual(fieldAccess, {
      defaultMode: "readonly",
      editableFields: [...EDITABLE_FIELDS],
      editableGroups: [...EDITABLE_GROUPS, ...LEGACY_EDITABLE_GROUPS],
    });
  });

  it("returns non-readonly appearance for a system admin regardless of persisted rule", () => {
    const appearance = buildSolicitudAppearance(
      solicitudCore({ estadoActual: state("VerificarFirmaYDocumentacion") }),
      {
        active: true,
        backgroundColor: "#FFC0FF",
        canManageAttachments: true,
        defaultMode: "readonly",
        editableFields: [],
        editableGroups: [],
        readonlyReason: READONLY_REASON,
        textColor: "#000000",
        workflowStateId: "state-1",
      },
      true,
    );

    assert.deepEqual(appearance, {
      backgroundColor: null,
      textColor: null,
    });
  });

  it("does not expose protected solicitud fields in editableFields", () => {
    const fieldAccess = buildSolicitudFieldAccess(
      solicitudCore({ estadoActual: state("CargaVendedor") }),
    );

    for (const field of [
      "solicitud.lineaPrestamoLegacyOid",
      "solicitud.ejecutivoSolicitud",
    ]) {
      assert.equal(
        fieldAccess.editableFields.includes(field as SolicitudFieldKey),
        false,
      );
    }
  });

  it("exposes firma digital solicitud fields in editableFields", () => {
    const fieldAccess = buildSolicitudFieldAccess(
      solicitudCore({ estadoActual: state("CargaVendedor") }),
    );

    assert.equal(
      fieldAccess.editableFields.includes("solicitud.linkFirmaDigital"),
      true,
    );
    assert.equal(
      fieldAccess.editableFields.includes("solicitud.firmaDigitalmente"),
      true,
    );
  });

  it("treats conyuge null as an edit attempt", () => {
    const targets = extractSolicitudPatchAccessTargets(
      updateInput({ conyuge: null }),
    );

    assert.deepEqual(targets.fields, [...CONYUGE_EDITABLE_FIELDS]);
  });

  it("extracts changed garantias as editable fields", () => {
    const targets = extractSolicitudPatchAccessTargets(
      updateInput({
        garantias: [{ nombre: "Gar 1" }],
      }),
      [],
    );

    assert.deepEqual(targets.groups, []);
    assert.deepEqual(targets.fields, ["garantias.nombre"]);
  });

  it("dedupes repeated garantias property changes across multiple rows", () => {
    const targets = extractSolicitudPatchAccessTargets(
      updateInput({
        garantias: [{ email: "uno@example.com" }, { email: "dos@example.com" }],
      }),
      [],
    );

    assert.deepEqual(targets.fields, ["garantias.email"]);
  });

  it("builds fieldAccess from a persisted active rule", () => {
    const fieldAccess = buildFieldAccessFromRuleRecord({
      active: true,
      backgroundColor: "#FF7F7F",
      canManageAttachments: true,
      defaultMode: "readonly",
      editableFields: [...EDITABLE_FIELDS],
      editableGroups: [...LEGACY_EDITABLE_GROUPS],
      readonlyReason: null,
      textColor: "#000000",
      workflowStateId: "state-1",
    });

    assert.deepEqual(fieldAccess, {
      defaultMode: "readonly",
      editableFields: [...EDITABLE_FIELDS],
      editableGroups: [...LEGACY_EDITABLE_GROUPS],
    });
  });

  it("returns readonly when persisted rule is missing", () => {
    const fieldAccess = buildFieldAccessFromRuleRecord(null);

    assert.deepEqual(fieldAccess, {
      defaultMode: "readonly",
      editableFields: [],
      editableGroups: [],
      readonlyReason: READONLY_REASON,
    });
  });

  it("returns readonly when persisted rule is inactive", () => {
    const fieldAccess = buildFieldAccessFromRuleRecord({
      active: false,
      backgroundColor: "#FF7F7F",
      canManageAttachments: true,
      defaultMode: "readonly",
      editableFields: [...EDITABLE_FIELDS],
      editableGroups: [...LEGACY_EDITABLE_GROUPS],
      readonlyReason: null,
      textColor: "#000000",
      workflowStateId: "state-1",
    });

    assert.deepEqual(fieldAccess, {
      defaultMode: "readonly",
      editableFields: [],
      editableGroups: [],
      readonlyReason: READONLY_REASON,
    });
  });

  it("returns readonly when persisted rule contains invalid field keys", () => {
    const errorMock = mock.method(console, "error", () => undefined);
    const fieldAccess = buildFieldAccessFromRuleRecord({
      active: true,
      backgroundColor: "#FF7F7F",
      canManageAttachments: true,
      defaultMode: "readonly",
      editableFields: [...EDITABLE_FIELDS, "solicitud.ejecutivoSolicitud"],
      editableGroups: [...LEGACY_EDITABLE_GROUPS],
      readonlyReason: null,
      textColor: "#000000",
      workflowStateId: "state-1",
    });

    assert.deepEqual(fieldAccess, {
      defaultMode: "readonly",
      editableFields: [],
      editableGroups: [],
      readonlyReason: READONLY_REASON,
    });
    assert.equal(errorMock.mock.calls.length, 1);
    assert.deepEqual(errorMock.mock.calls[0]?.arguments, [
      "solicitud_field_access_invalid_rule_fallback",
      {
        fallback: "readonly",
        invalidKey: "solicitud.ejecutivoSolicitud",
        reason: "blocked_editable_field",
        stateCode: undefined,
        workflowStateId: "state-1",
      },
    ]);
    errorMock.mock.restore();
  });

  it("returns readonly when persisted rule contains duplicate groups", () => {
    const errorMock = mock.method(console, "error", () => undefined);
    const fieldAccess = buildFieldAccessFromRuleRecord({
      active: true,
      backgroundColor: "#FF7F7F",
      canManageAttachments: true,
      defaultMode: "readonly",
      editableFields: [...EDITABLE_FIELDS],
      editableGroups: ["garantias", "garantias"],
      readonlyReason: null,
      textColor: "#000000",
      workflowStateId: "state-1",
    });

    assert.deepEqual(fieldAccess, {
      defaultMode: "readonly",
      editableFields: [],
      editableGroups: [],
      readonlyReason: READONLY_REASON,
    });
    assert.equal(errorMock.mock.calls.length, 1);
    assert.deepEqual(errorMock.mock.calls[0]?.arguments, [
      "solicitud_field_access_invalid_rule_fallback",
      {
        fallback: "readonly",
        invalidKey: undefined,
        reason: "duplicate_editable_groups",
        stateCode: undefined,
        workflowStateId: "state-1",
      },
    ]);
    errorMock.mock.restore();
  });

  it("logs state code context when invalid persisted rule is resolved from solicitud", () => {
    const errorMock = mock.method(console, "error", () => undefined);

    buildSolicitudFieldAccess(solicitudCore({ estadoActual: state("Confirmada") }), {
      active: true,
      backgroundColor: "#FF7F7F",
      canManageAttachments: true,
      defaultMode: "readonly",
      editableFields: ["solicitud.ejecutivoSolicitud"],
      editableGroups: [],
      readonlyReason: null,
      textColor: "#000000",
      workflowStateId: "state-1",
    });

    assert.equal(errorMock.mock.calls.length, 1);
    assert.deepEqual(errorMock.mock.calls[0]?.arguments, [
      "solicitud_field_access_invalid_rule_fallback",
      {
        fallback: "readonly",
        invalidKey: "solicitud.ejecutivoSolicitud",
        reason: "blocked_editable_field",
        stateCode: "Confirmada",
        workflowStateId: "state-1",
      },
    ]);
    errorMock.mock.restore();
  });

  it("keeps legacy garantias group effective by expanding its fields", () => {
    const fieldAccess = buildFieldAccessFromRuleRecord({
      active: true,
      backgroundColor: "#FF7F7F",
      canManageAttachments: true,
      defaultMode: "readonly",
      editableFields: [],
      editableGroups: ["garantias"],
      readonlyReason: null,
      textColor: "#000000",
      workflowStateId: "state-1",
    });

    for (const field of GARANTIAS_EDITABLE_FIELDS) {
      assert.equal(fieldAccess.editableFields.includes(field), true);
    }
    assert.deepEqual(fieldAccess.editableGroups, ["garantias"]);
  });

  it("returns persisted appearance from an active rule", () => {
    const appearance = buildFieldAccessAppearanceFromRuleRecord({
      active: true,
      backgroundColor: "#FF7F7F",
      canManageAttachments: true,
      defaultMode: "readonly",
      editableFields: [...EDITABLE_FIELDS],
      editableGroups: [],
      readonlyReason: null,
      textColor: "#000000",
      workflowStateId: "state-1",
    });

    assert.deepEqual(appearance, {
      backgroundColor: "#FF7F7F",
      textColor: "#000000",
    });
  });

  it("returns empty appearance when persisted rule is missing", () => {
    const appearance = buildFieldAccessAppearanceFromRuleRecord(null);

    assert.deepEqual(appearance, {
      backgroundColor: null,
      textColor: null,
    });
  });

  it("returns empty appearance when persisted rule is invalid", () => {
    const errorMock = mock.method(console, "error", () => undefined);
    const appearance = buildFieldAccessAppearanceFromRuleRecord({
      active: true,
      backgroundColor: "#FF7F7F",
      canManageAttachments: true,
      defaultMode: "readonly",
      editableFields: ["solicitud.ejecutivoSolicitud"],
      editableGroups: [],
      readonlyReason: null,
      textColor: "#000000",
      workflowStateId: "state-1",
    });

    assert.deepEqual(appearance, {
      backgroundColor: null,
      textColor: null,
    });
    errorMock.mock.restore();
  });

  it("builds persisted appearance for a solicitud state", () => {
    const appearance = buildSolicitudAppearance(
      solicitudCore({ estadoActual: state("VerificarFirmaYDocumentacion") }),
      {
        active: true,
        backgroundColor: "#FFC0FF",
        canManageAttachments: true,
        defaultMode: "readonly",
        editableFields: [],
        editableGroups: [],
        readonlyReason: READONLY_REASON,
        textColor: "#000000",
        workflowStateId: "state-1",
      },
    );

    assert.deepEqual(appearance, {
      backgroundColor: "#FFC0FF",
      textColor: "#000000",
    });
  });
});

function updateInput(overrides?: Partial<UpdateSolicitudInput>): UpdateSolicitudInput {
  return {
    createdBy: "user-1",
    createdByLegacyUser: "seller-1",
    currentUser: {
      id: "user-1",
      workflowOwnerId: "owner-1",
    },
    id: "sol-1",
    ...overrides,
  };
}

function solicitudCore(overrides: Partial<SolicitudCore> = {}): SolicitudCore {
  return {
    conyuge: null,
    createdAt: new Date("2026-05-12T10:00:00.000Z"),
    createdBy: "creator-1",
    cuotaResultante: "10000",
    cuotas: 12,
    cupoTitular: 150000,
    datosLaborales: {
      actividadLaboral: "Administrativa",
      antiguedadLaboralMeses: 24,
      descuentosSueldo: 1000,
      domicilioLaboralCalle: "Oficina",
      domicilioLaboralLocalidad: "CABA",
      domicilioLaboralNroPuerta: "123",
      domicilioLaboralPisoDepto: "4B",
      empleador: "Empresa SA",
      fechaIngresoLaboral: "2024-01-10",
      montoRecibo: 250000,
      relacionLaboral: "Dependencia",
      tarjetas: "Visa",
      vehiculo: "No",
      vivienda: "Propia",
    },
    ejecutivoSolicitud: "Ejecutivo Uno",
    estadoActual: state("CargaVendedor"),
    fechaPrimerVencimiento: "2026-06-01",
    firmaDigitalmente: false,
    garantias: [],
    id: "sol-1",
    legacyOid: null,
    lineaPrestamoDescripcion: "Personal",
    lineaPrestamoLegacyOid: "LP-1",
    montoAFinanciar: 100000,
    motivo: "Compra",
    nroOperacion: "OP-321",
    nroSolicitud: null,
    observaciones: "Inicial",
    participants: [],
    titular: {
      apellidoDenominacion: "Perez",
      cbu: "2850590940090418135201",
      celular: "1122334455",
      cuit: "20333444559",
      domicilioCalle: "Siempre Viva",
      email: "juan@example.com",
      estadoCivil: "Soltero",
      localidad: "CABA",
      nacionalidad: "Argentina",
      nombre: "Juan",
      nroDocumento: "33344455",
      nroPuerta: "742",
      nroSocio: "SM-1",
      personaExpuestaPoliticamente: false,
      sexo: "M",
      telefonoFijo: "1144441111",
      tipoDocumento: "DNI",
    },
    updatedAt: new Date("2026-05-12T10:00:00.000Z"),
    vendedorSolicitud: "Vendedor Uno",
    ...overrides,
  };
}

function state(code: string) {
  return {
    code,
    id: `state-${code}`,
    name: code,
    ownerId: "owner-1",
  };
}
