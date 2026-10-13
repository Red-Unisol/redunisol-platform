import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import {
  buildSolicitudCapabilities,
  canManageSolicitudAttachments,
  canEditSolicitud,
  canViewSolicitud,
} from "./SolicitudPermissions";

describe("SolicitudPermissions", () => {
  it("permite cargar en cualquier estado a las tres áreas y solo borrar a administradores", () => {
    for (const code of ["RIESGO", "VENDEDORES", "TESORERIA"]) {
      for (const stateCode of [
        "CargaVendedor",
        "RevisionRiesgo",
        "PreAprobada",
        "Transferir",
        "Pagada",
        "Desestimada",
      ]) {
        const target = solicitud({ stateCode, ownerId: "otra-area" });
        const actor = {
          id: "operador",
          workflowOwnerId: "area",
          workflowOwnerCode: code,
        };
        for (const rule of [
          null,
          {
            active: false,
            canManageAttachments: false,
            workflowStateId: "state-1",
          },
        ]) {
          assert.equal(
            canEditSolicitud(actor, target, "UPLOAD_ATTACHMENT", rule),
            true,
          );
          assert.equal(
            canEditSolicitud(actor, target, "DELETE_ATTACHMENT", rule),
            false,
          );
          assert.equal(
            canEditSolicitud(
              { ...actor, isSystemAdmin: true },
              target,
              "DELETE_ATTACHMENT",
              rule,
            ),
            true,
          );
          assert.equal(
            canEditSolicitud(actor, target, "MANAGE_CANCELACIONES", rule),
            false,
          );
        }
      }
    }
    assert.equal(
      canEditSolicitud(
        { id: "sin-area", workflowOwnerId: null, workflowOwnerCode: "RIESGO" },
        solicitud({ ownerId: "otra-area" }),
        "UPLOAD_ATTACHMENT",
      ),
      false,
    );
  });

  it("permite a Riesgo editar datos en Vendedores y cargar adjuntos sin cambiar estado ni borrar", () => {
    const target = solicitud({
      stateCode: "PreAprobada",
      ownerId: "owner-vendedor",
    });
    target.estadoActual.owner = {
      id: "owner-vendedor",
      code: "VENDEDORES",
      name: "Vendedores",
    };
    const actor = {
      id: "risk-user",
      workflowOwnerId: "owner-riesgo",
      workflowOwnerCode: "RIESGO",
    };
    const capabilities = buildSolicitudCapabilities(actor, target);
    assert.equal(capabilities.canEdit, true);
    assert.equal(capabilities.canChangeState, false);
    assert.equal(capabilities.canUploadAdjuntos, true);
    assert.equal(capabilities.canDeleteAdjuntos, false);
    assert.equal(capabilities.canManageCancelaciones, false);
    for (const code of ["TESORERIA", "SISTEMA"]) {
      target.estadoActual.owner.code = code;
      assert.equal(canEditSolicitud(actor, target, "EDIT_DATA"), false);
    }
    target.estadoActual.owner.code = "VENDEDORES";
    assert.equal(
      canEditSolicitud(
        { ...actor, workflowOwnerCode: "TESORERIA" },
        target,
        "EDIT_DATA",
      ),
      false,
    );
  });

  it("allows current owner edit and upload, but restricts delete to administrators", () => {
    const currentOwnerSolicitud = solicitud({
      createdBy: "creator-1",
      ownerId: "owner-riesgo",
      stateCode: "RevisionRiesgo",
    });
    const currentOwnerUser = {
      id: "riesgo-operator-1",
      workflowOwnerId: "owner-riesgo",
    };

    assert.equal(
      canViewSolicitud(currentOwnerUser, currentOwnerSolicitud),
      true,
    );
    assert.equal(
      canEditSolicitud(currentOwnerUser, currentOwnerSolicitud, "CHANGE_STATE"),
      true,
    );
    assert.equal(
      canEditSolicitud(currentOwnerUser, currentOwnerSolicitud, "EDIT_DATA"),
      true,
    );
    assert.equal(
      canEditSolicitud(
        currentOwnerUser,
        currentOwnerSolicitud,
        "UPLOAD_ATTACHMENT",
        {
          active: true,
          canManageAttachments: true,
          workflowStateId: "state-1",
        },
      ),
      true,
    );
    assert.equal(
      canEditSolicitud(
        currentOwnerUser,
        currentOwnerSolicitud,
        "DELETE_ATTACHMENT",
        {
          active: true,
          canManageAttachments: true,
          workflowStateId: "state-1",
        },
      ),
      false,
    );
  });

  it("allows attachment management only when owner, rule active and canManageAttachments are all true", () => {
    const currentOwnerUser = {
      id: "riesgo-operator-1",
      workflowOwnerId: "owner-riesgo",
    };
    const currentOwnerSolicitud = solicitud({
      createdBy: "creator-1",
      ownerId: "owner-riesgo",
      stateCode: "RevisionRiesgo",
    });

    assert.equal(
      canManageSolicitudAttachments({
        fieldAccess: {
          active: true,
          canManageAttachments: true,
          workflowStateId: "state-1",
        },
        solicitud: currentOwnerSolicitud,
        user: currentOwnerUser,
      }),
      true,
    );
  });

  it("blocks attachment management when the field access rule is missing, inactive or disabled", () => {
    const currentOwnerUser = {
      id: "riesgo-operator-1",
      workflowOwnerId: "owner-riesgo",
    };
    const currentOwnerSolicitud = solicitud({
      createdBy: "creator-1",
      ownerId: "owner-riesgo",
      stateCode: "RevisionRiesgo",
    });

    assert.equal(
      canManageSolicitudAttachments({
        fieldAccess: null,
        solicitud: currentOwnerSolicitud,
        user: currentOwnerUser,
      }),
      false,
    );
    assert.equal(
      canManageSolicitudAttachments({
        fieldAccess: {
          active: false,
          canManageAttachments: true,
          workflowStateId: "state-1",
        },
        solicitud: currentOwnerSolicitud,
        user: currentOwnerUser,
      }),
      false,
    );
    assert.equal(
      canManageSolicitudAttachments({
        fieldAccess: {
          active: true,
          canManageAttachments: false,
          workflowStateId: "state-1",
        },
        solicitud: currentOwnerSolicitud,
        user: currentOwnerUser,
      }),
      false,
    );
  });

  it("allows any authenticated user to view a solicitud outside their current owner", () => {
    assert.equal(
      canViewSolicitud(
        { id: "user-404", workflowOwnerId: "owner-vendedor" },
        solicitud({ createdBy: "creator-1", ownerId: "owner-analista" }),
      ),
      true,
    );
  });

  it("keeps participants as read-only when they are outside the current owner", () => {
    assert.equal(
      canViewSolicitud(
        { id: "participant-1", workflowOwnerId: "owner-vendedor" },
        solicitud({
          createdBy: "creator-1",
          ownerId: "owner-analista",
          participants: [{ userId: "participant-1" }],
        }),
      ),
      true,
    );
  });

  it("allows a user from the current owner to view operationally", () => {
    assert.equal(
      canViewSolicitud(
        { id: "operator-1", workflowOwnerId: "owner-analista" },
        solicitud({ createdBy: "creator-1", ownerId: "owner-analista" }),
      ),
      true,
    );
  });

  it("allows read access but blocks operation for a user outside the current owner", () => {
    const unrelatedUser = { id: "user-404", workflowOwnerId: "owner-vendedor" };
    const riesgoSolicitud = solicitud({
      createdBy: "creator-1",
      ownerId: "owner-analista",
    });

    assert.equal(canViewSolicitud(unrelatedUser, riesgoSolicitud), true);
    assert.equal(
      canEditSolicitud(unrelatedUser, riesgoSolicitud, "CHANGE_STATE"),
      false,
    );
  });

  it("does not allow operating actions only by being a participant", () => {
    assert.equal(
      canEditSolicitud(
        { id: "participant-1", workflowOwnerId: "owner-vendedor" },
        solicitud({
          createdBy: "creator-1",
          ownerId: "owner-analista",
          participants: [{ userId: "participant-1" }],
        }),
        "EDIT_DATA",
      ),
      false,
    );
    assert.equal(
      canEditSolicitud(
        { id: "participant-1", workflowOwnerId: "owner-vendedor" },
        solicitud({
          createdBy: "creator-1",
          ownerId: "owner-analista",
          participants: [{ userId: "participant-1" }],
        }),
        "UPLOAD_ATTACHMENT",
      ),
      false,
    );
    assert.equal(
      canEditSolicitud(
        { id: "participant-1", workflowOwnerId: "owner-vendedor" },
        solicitud({
          createdBy: "creator-1",
          ownerId: "owner-analista",
          participants: [{ userId: "participant-1" }],
        }),
        "DELETE_ATTACHMENT",
      ),
      false,
    );
  });

  it("does not allow creator outside current owner to operate actions", () => {
    assert.equal(
      canEditSolicitud(
        { id: "creator-1", workflowOwnerId: "owner-vendedor" },
        solicitud({ createdBy: "creator-1", ownerId: "owner-analista" }),
        "EDIT_DATA",
      ),
      false,
    );
    assert.equal(
      canEditSolicitud(
        { id: "creator-1", workflowOwnerId: "owner-vendedor" },
        solicitud({ createdBy: "creator-1", ownerId: "owner-analista" }),
        "UPLOAD_ATTACHMENT",
      ),
      false,
    );
    assert.equal(
      canEditSolicitud(
        { id: "creator-1", workflowOwnerId: "owner-vendedor" },
        solicitud({ createdBy: "creator-1", ownerId: "owner-analista" }),
        "DELETE_ATTACHMENT",
      ),
      false,
    );
  });

  it("does not use assignedToUserId as a permission source", () => {
    assert.equal(
      canEditSolicitud(
        { id: "assigned-user", workflowOwnerId: "owner-vendedor" },
        solicitud({
          assignedToUserId: "assigned-user",
          createdBy: "assigned-user",
          ownerId: "owner-riesgo",
          participants: [{ userId: "assigned-user" }],
        }),
        "CHANGE_STATE",
      ),
      false,
    );
  });

  it("allows a RIESGO owner user to operate even when they are not assignedToUserId", () => {
    assert.equal(
      canEditSolicitud(
        { id: "riesgo-operator-2", workflowOwnerId: "owner-riesgo" },
        solicitud({
          assignedToUserId: "riesgo-operator-1",
          ownerId: "owner-riesgo",
          stateCode: "RevisionRiesgo",
        }),
        "CHANGE_STATE",
      ),
      true,
    );
  });

  it("keeps operational actions limited to the current owner", () => {
    assert.equal(
      canEditSolicitud(
        { id: "participant-1", workflowOwnerId: "owner-vendedor" },
        solicitud({
          createdBy: "creator-1",
          ownerId: "owner-analista",
          participants: [{ userId: "participant-1" }],
        }),
        "CHANGE_STATE",
      ),
      false,
    );
  });

  it("builds read capabilities for participants without opening write actions", () => {
    assert.deepEqual(
      buildSolicitudCapabilities(
        { id: "participant-1", workflowOwnerId: "owner-vendedor" },
        solicitud({
          createdBy: "creator-1",
          ownerId: "owner-analista",
          participants: [{ userId: "participant-1" }],
        }),
      ),
      {
        canChangeState: false,
        canDeleteAdjuntos: false,
        canDownloadAdjuntos: true,
        canEdit: false,
        canManageCancelaciones: false,
        canUploadAdjuntos: false,
        canView: true,
        canViewHistory: true,
      },
    );
  });

  it("allows read and blocks operation for user without owner match and without tracking relation", () => {
    const unrelatedUser = { id: "user-404", workflowOwnerId: null };
    const riesgoSolicitud = solicitud({
      createdBy: "creator-1",
      ownerId: "owner-riesgo",
      participants: [],
      stateCode: "RevisionRiesgo",
    });

    assert.equal(canViewSolicitud(unrelatedUser, riesgoSolicitud), true);
    assert.equal(
      canEditSolicitud(unrelatedUser, riesgoSolicitud, "CHANGE_STATE"),
      false,
    );
    assert.equal(
      canEditSolicitud(unrelatedUser, riesgoSolicitud, "EDIT_DATA"),
      false,
    );
    assert.equal(
      canEditSolicitud(unrelatedUser, riesgoSolicitud, "UPLOAD_ATTACHMENT"),
      false,
    );
    assert.equal(
      canEditSolicitud(unrelatedUser, riesgoSolicitud, "DELETE_ATTACHMENT"),
      false,
    );
  });

  it("allows a system admin to operate regardless of ownership", () => {
    const adminUser = {
      id: "admin-1",
      isSystemAdmin: true,
      workflowOwnerId: null,
    };
    const outsideOwnerSolicitud = solicitud({
      createdBy: "creator-1",
      ownerId: "owner-riesgo",
      stateCode: "RevisionRiesgo",
    });

    assert.equal(canViewSolicitud(adminUser, outsideOwnerSolicitud), true);
    assert.equal(
      canEditSolicitud(adminUser, outsideOwnerSolicitud, "EDIT_DATA"),
      true,
    );
    assert.equal(
      canEditSolicitud(adminUser, outsideOwnerSolicitud, "CHANGE_STATE"),
      true,
    );
    assert.equal(
      canEditSolicitud(adminUser, outsideOwnerSolicitud, "UPLOAD_ATTACHMENT"),
      true,
    );
    assert.equal(
      canEditSolicitud(adminUser, outsideOwnerSolicitud, "DELETE_ATTACHMENT"),
      true,
    );
  });

  it("allows an analista to edit data outside their current owner but not to change state or manage attachments", () => {
    const analistaUser = {
      id: "riesgo-1",
      isAnalista: true,
      workflowOwnerId: "owner-riesgo",
    };
    const outsideOwnerSolicitud = solicitud({
      createdBy: "creator-1",
      ownerId: "owner-vendedor",
      stateCode: "CargaVendedor",
    });

    assert.equal(canViewSolicitud(analistaUser, outsideOwnerSolicitud), true);
    assert.equal(
      canEditSolicitud(analistaUser, outsideOwnerSolicitud, "EDIT_DATA"),
      true,
    );
    assert.equal(
      canEditSolicitud(analistaUser, outsideOwnerSolicitud, "CHANGE_STATE"),
      false,
    );
    assert.equal(
      canEditSolicitud(
        analistaUser,
        outsideOwnerSolicitud,
        "UPLOAD_ATTACHMENT",
      ),
      false,
    );
    assert.equal(
      canEditSolicitud(
        analistaUser,
        outsideOwnerSolicitud,
        "DELETE_ATTACHMENT",
      ),
      false,
    );
  });

  it("allows a RIESGO owner to change state on a Transferir solicitud owned by another owner", () => {
    const riesgoUser = {
      id: "riesgo-1",
      workflowOwnerId: "owner-riesgo",
      workflowOwnerCode: "RIESGO",
    };
    const transferirSolicitud = solicitud({
      createdBy: "creator-1",
      ownerId: "owner-tesoreria",
      stateCode: "Transferir",
    });

    assert.equal(
      canEditSolicitud(riesgoUser, transferirSolicitud, "CHANGE_STATE"),
      true,
    );
  });

  it("does not extend the RIESGO Transferir exception to other states or actions", () => {
    const riesgoUser = {
      id: "riesgo-1",
      workflowOwnerId: "owner-riesgo",
      workflowOwnerCode: "RIESGO",
    };
    const outsideOwnerSolicitud = solicitud({
      createdBy: "creator-1",
      ownerId: "owner-vendedor",
      stateCode: "CargaVendedor",
    });
    const transferirSolicitud = solicitud({
      createdBy: "creator-1",
      ownerId: "owner-tesoreria",
      stateCode: "Transferir",
    });

    assert.equal(
      canEditSolicitud(riesgoUser, outsideOwnerSolicitud, "CHANGE_STATE"),
      false,
    );
    assert.equal(
      canEditSolicitud(riesgoUser, transferirSolicitud, "EDIT_DATA"),
      false,
    );
  });

  it("builds partial capabilities for an analista outside the current owner", () => {
    const analistaUser = {
      id: "riesgo-1",
      isAnalista: true,
      workflowOwnerId: "owner-riesgo",
    };

    assert.deepEqual(
      buildSolicitudCapabilities(
        analistaUser,
        solicitud({ createdBy: "creator-1", ownerId: "owner-vendedor" }),
      ),
      {
        canChangeState: false,
        canDeleteAdjuntos: false,
        canDownloadAdjuntos: true,
        canEdit: true,
        canManageCancelaciones: false,
        canUploadAdjuntos: false,
        canView: true,
        canViewHistory: true,
      },
    );
  });

  it("allows a system admin to manage attachments without a field access rule", () => {
    const adminUser = {
      id: "admin-1",
      isSystemAdmin: true,
      workflowOwnerId: null,
    };
    const outsideOwnerSolicitud = solicitud({
      createdBy: "creator-1",
      ownerId: "owner-riesgo",
      stateCode: "RevisionRiesgo",
    });

    assert.equal(
      canManageSolicitudAttachments({
        fieldAccess: null,
        solicitud: outsideOwnerSolicitud,
        user: adminUser,
      }),
      true,
    );
  });

  it("builds full capabilities for a system admin outside the current owner", () => {
    const adminUser = {
      id: "admin-1",
      isSystemAdmin: true,
      workflowOwnerId: null,
    };

    assert.deepEqual(
      buildSolicitudCapabilities(
        adminUser,
        solicitud({ createdBy: "creator-1", ownerId: "owner-analista" }),
      ),
      {
        canChangeState: true,
        canDeleteAdjuntos: true,
        canDownloadAdjuntos: true,
        canEdit: true,
        canManageCancelaciones: true,
        canUploadAdjuntos: true,
        canView: true,
        canViewHistory: true,
      },
    );
  });
});

function solicitud(
  overrides: {
    assignedToUserId?: string | null;
    createdBy?: string;
    ownerId?: string;
    participants?: { userId: string }[];
    stateCode?: string;
  } = {},
): SolicitudCore {
  return {
    createdAt: new Date("2026-05-12T10:00:00.000Z"),
    assignedToUserId: overrides.assignedToUserId,
    createdBy: overrides.createdBy ?? "creator-1",
    cuotaResultante: null,
    cuotas: null,
    ejecutivoSolicitud: null,
    estadoActual: {
      code: overrides.stateCode ?? "CargaVendedor",
      id: "state-1",
      name: "Carga vendedor",
      ownerId: overrides.ownerId ?? "owner-vendedor",
    },
    firmaDigitalmente: false,
    garantias: [],
    id: "sol-1",
    legacyOid: null,
    lineaPrestamoDescripcion: "Personal",
    lineaPrestamoLegacyOid: "LP-1",
    conyuge: null,
    datosLaborales: {
      actividadLaboral: null,
      antiguedadLaboralMeses: null,
      descuentosSueldo: null,
      domicilioLaboralCalle: null,
      domicilioLaboralLocalidad: null,
      domicilioLaboralNroPuerta: null,
      domicilioLaboralPisoDepto: null,
      empleador: null,
      fechaIngresoLaboral: null,
      montoRecibo: null,
      relacionLaboral: null,
      tarjetas: null,
      vehiculo: null,
      vivienda: null,
    },
    montoAFinanciar: null,
    motivo: null,
    nroSolicitud: null,
    observaciones: null,
    participants: overrides.participants ?? [],
    titular: {
      apellidoDenominacion: null,
      cbu: null,
      cbuNoHabitual: null,
      celular: null,
      cuit: null,
      domicilioCalle: null,
      email: null,
      localidad: null,
      nombre: null,
      nroDocumento: null,
      nroPuerta: null,
      nroSocio: null,
      tipoDocumento: null,
    },
    updatedAt: new Date("2026-05-12T10:00:00.000Z"),
    vendedorSolicitud: null,
  };
}
