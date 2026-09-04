import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SolicitudFieldAccessRulesRepository } from "../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type {
  PersistSolicitudFieldAccessRuleInput,
  SolicitudFieldAccessAdminRepository,
  SolicitudFieldAccessAdminRuleRecord,
  WorkflowStateAdminRecord,
} from "../../domain/repositories/SolicitudFieldAccessAdminRepository";
import {
  FieldAccessRuleStateNotFoundError,
  FieldAccessRuleVersionConflictError,
} from "../../domain/solicitudes-core-errors";
import { GetFieldAccessFieldCatalogUseCase } from "./GetFieldAccessFieldCatalog.use-case";
import { GetFieldAccessRuleByStateUseCase } from "./GetFieldAccessRuleByState.use-case";
import { ListFieldAccessRulesUseCase } from "./ListFieldAccessRules.use-case";
import { UpdateFieldAccessRuleUseCase } from "./UpdateFieldAccessRule.use-case";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import { GetSolicitudByIdUseCase } from "./GetSolicitudById.use-case";
import { UpdateSolicitudUseCase } from "./UpdateSolicitud.use-case";

describe("FieldAccess admin use cases", () => {
  it("lists states with resolved fieldAccess source", async () => {
    const repository = createAdminRepository();
    const useCase = new ListFieldAccessRulesUseCase({ repository });

    const result = await useCase.execute({ currentUserId: "admin-1" });

    assert.equal(result.rules.length, 3);
    assert.equal(result.rules[0].source, "persisted");
    assert.equal(result.rules[1].source, "persisted");
    assert.equal(result.rules[2].source, "persisted");
  });

  it("returns one rule by state", async () => {
    const repository = createAdminRepository();
    const useCase = new GetFieldAccessRuleByStateUseCase({ repository });

    const result = await useCase.execute({
      currentUserId: "admin-1",
      stateCode: "CargaVendedor",
    });

    assert.equal(result.state.code, "CargaVendedor");
    assert.deepEqual(result.rule?.editableGroups, ["garantias"]);
    assert.equal(result.source, "persisted");
  });

  it("returns 404 when state does not exist", async () => {
    const repository = createAdminRepository();
    const useCase = new GetFieldAccessRuleByStateUseCase({ repository });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUserId: "admin-1",
          stateCode: "NoExiste",
        }),
      FieldAccessRuleStateNotFoundError,
    );
  });

  it("returns the field catalog without blocked fields in grouped fields", async () => {
    const repository = createAdminRepository();
    const useCase = new GetFieldAccessFieldCatalogUseCase({ repository });

    const result = await useCase.execute();

    assert.deepEqual(result.allowedDefaultModes, ["readonly"]);
    assert.deepEqual(result.groupCatalog, []);
    assert.equal(result.fieldCatalog.garantias.includes("garantias.email"), true);
    assert.equal(
      result.fieldCatalog.solicitud.includes("solicitud.linkFirmaDigital" as never),
      true,
    );
    assert.equal(
      result.fieldCatalog.solicitud.includes(
        "solicitud.firmaDigitalmente" as never,
      ),
      true,
    );
    assert.equal(
      (result.blockedFields as readonly string[]).includes(
        "solicitud.linkFirmaDigital",
      ),
      false,
    );
  });

  it("updates an existing rule and increments version", async () => {
    const repository = createAdminRepository();
    const useCase = new UpdateFieldAccessRuleUseCase({ repository });

    const result = await useCase.execute({
      active: true,
      canManageAttachments: true,
      currentUserId: "admin-77",
      editableFields: ["titular.nombre", "solicitud.motivo"],
      editableGroups: [],
      stateCode: "CargaVendedor",
      version: 1,
    });

    assert.equal(result.rule.version, 2);
    assert.equal(result.rule.updatedBy, "admin-77");
    assert.deepEqual(result.rule.editableFields, [
      "solicitud.motivo",
      "titular.nombre",
    ]);
    assert.equal(repository.getLastAudit()?.changedBy, "admin-77");
  });

  it("updates only backgroundColor and preserves textColor", async () => {
    const repository = createAdminRepository();
    const useCase = new UpdateFieldAccessRuleUseCase({ repository });

    const result = await useCase.execute({
      active: true,
      backgroundColor: "#F3F4F6",
      canManageAttachments: true,
      currentUserId: "admin-77",
      editableFields: ["titular.nombre", "solicitud.motivo"],
      editableGroups: [],
      stateCode: "CargaVendedor",
      version: 1,
    });

    assert.equal(result.rule.backgroundColor, "#F3F4F6");
    assert.equal(result.rule.textColor, "#000000");
  });

  it("updates only textColor and preserves backgroundColor", async () => {
    const repository = createAdminRepository();
    const useCase = new UpdateFieldAccessRuleUseCase({ repository });

    const result = await useCase.execute({
      active: true,
      canManageAttachments: true,
      currentUserId: "admin-77",
      editableFields: ["titular.nombre", "solicitud.motivo"],
      editableGroups: [],
      stateCode: "CargaVendedor",
      textColor: "#111827",
      version: 1,
    });

    assert.equal(result.rule.backgroundColor, "#FF7F7F");
    assert.equal(result.rule.textColor, "#111827");
  });

  it("updates both colors together", async () => {
    const repository = createAdminRepository();
    const useCase = new UpdateFieldAccessRuleUseCase({ repository });

    const result = await useCase.execute({
      active: true,
      backgroundColor: "#F3F4F6",
      canManageAttachments: true,
      currentUserId: "admin-77",
      editableFields: ["titular.nombre", "solicitud.motivo"],
      editableGroups: [],
      stateCode: "CargaVendedor",
      textColor: "#111827",
      version: 1,
    });

    assert.equal(result.rule.backgroundColor, "#F3F4F6");
    assert.equal(result.rule.textColor, "#111827");
  });

  it("clears only backgroundColor and preserves textColor", async () => {
    const repository = createAdminRepository();
    const useCase = new UpdateFieldAccessRuleUseCase({ repository });

    const result = await useCase.execute({
      active: true,
      backgroundColor: null,
      canManageAttachments: true,
      currentUserId: "admin-77",
      editableFields: ["titular.nombre", "solicitud.motivo"],
      editableGroups: [],
      stateCode: "CargaVendedor",
      version: 1,
    });

    assert.equal(result.rule.backgroundColor, null);
    assert.equal(result.rule.textColor, "#000000");
  });

  it("clears only textColor and preserves backgroundColor", async () => {
    const repository = createAdminRepository();
    const useCase = new UpdateFieldAccessRuleUseCase({ repository });

    const result = await useCase.execute({
      active: true,
      canManageAttachments: true,
      currentUserId: "admin-77",
      editableFields: ["titular.nombre", "solicitud.motivo"],
      editableGroups: [],
      stateCode: "CargaVendedor",
      textColor: null,
      version: 1,
    });

    assert.equal(result.rule.backgroundColor, "#FF7F7F");
    assert.equal(result.rule.textColor, null);
  });

  it("clears both colors", async () => {
    const repository = createAdminRepository();
    const useCase = new UpdateFieldAccessRuleUseCase({ repository });

    const result = await useCase.execute({
      active: true,
      backgroundColor: null,
      canManageAttachments: true,
      currentUserId: "admin-77",
      editableFields: ["titular.nombre", "solicitud.motivo"],
      editableGroups: [],
      stateCode: "CargaVendedor",
      textColor: null,
      version: 1,
    });

    assert.equal(result.rule.backgroundColor, null);
    assert.equal(result.rule.textColor, null);
  });

  it("distinguishes omitted colors from explicit null", async () => {
    const repository = createAdminRepository();
    const useCase = new UpdateFieldAccessRuleUseCase({ repository });

    const omittedResult = await useCase.execute({
      active: true,
      canManageAttachments: true,
      currentUserId: "admin-77",
      editableFields: ["titular.nombre", "solicitud.motivo"],
      editableGroups: [],
      stateCode: "CargaVendedor",
      version: 1,
    });

    assert.equal(omittedResult.rule.backgroundColor, "#FF7F7F");
    assert.equal(omittedResult.rule.textColor, "#000000");

    const clearedResult = await useCase.execute({
      active: true,
      backgroundColor: null,
      canManageAttachments: true,
      currentUserId: "admin-77",
      editableFields: ["titular.nombre", "solicitud.motivo"],
      editableGroups: [],
      stateCode: "Revisar",
      textColor: null,
      version: 1,
    });

    assert.equal(clearedResult.rule.backgroundColor, null);
    assert.equal(clearedResult.rule.textColor, null);
  });

  it("rejects invalid backgroundColor", async () => {
    const repository = createAdminRepository();
    const useCase = new UpdateFieldAccessRuleUseCase({ repository });

    await assert.rejects(
      () =>
        useCase.execute({
          active: true,
          backgroundColor: "rgb(255,0,0)",
          canManageAttachments: true,
          currentUserId: "admin-77",
          editableFields: ["titular.nombre", "solicitud.motivo"],
          editableGroups: [],
          stateCode: "CargaVendedor",
          version: 1,
        }),
      /FIELD_ACCESS_RULE_INVALID_APPEARANCE_COLOR/,
    );
  });

  it("rejects invalid textColor", async () => {
    const repository = createAdminRepository();
    const useCase = new UpdateFieldAccessRuleUseCase({ repository });

    await assert.rejects(
      () =>
        useCase.execute({
          active: true,
          canManageAttachments: true,
          currentUserId: "admin-77",
          editableFields: ["titular.nombre", "solicitud.motivo"],
          editableGroups: [],
          stateCode: "CargaVendedor",
          textColor: "rgb(0,0,0)",
          version: 1,
        }),
      /FIELD_ACCESS_RULE_INVALID_APPEARANCE_COLOR/,
    );
  });

  it("returns 409 on version mismatch", async () => {
    const repository = createAdminRepository();
    const useCase = new UpdateFieldAccessRuleUseCase({ repository });

    await assert.rejects(
      () =>
        useCase.execute({
          active: true,
          canManageAttachments: true,
          currentUserId: "admin-1",
          editableFields: ["solicitud.motivo"],
          editableGroups: [],
          stateCode: "CargaVendedor",
          version: 99,
        }),
      FieldAccessRuleVersionConflictError,
    );
  });

  it("creates a missing rule only when version is 0", async () => {
    const repository = createAdminRepository({ withoutRuleFor: "Motor" });
    const useCase = new UpdateFieldAccessRuleUseCase({ repository });

    const result = await useCase.execute({
      active: true,
      canManageAttachments: true,
      currentUserId: "admin-1",
      editableFields: ["solicitud.motivo"],
      editableGroups: [],
      stateCode: "Motor",
      version: 0,
    });

    assert.equal(result.rule.version, 1);
    assert.deepEqual(result.rule.editableFields, ["solicitud.motivo"]);
  });

  it("returns 409 when missing rule is created with a non-zero version", async () => {
    const repository = createAdminRepository({ withoutRuleFor: "Motor" });
    const useCase = new UpdateFieldAccessRuleUseCase({ repository });

    await assert.rejects(
      () =>
        useCase.execute({
          active: true,
          canManageAttachments: true,
          currentUserId: "admin-1",
          editableFields: ["solicitud.motivo"],
          editableGroups: [],
          stateCode: "Motor",
          version: 1,
        }),
      FieldAccessRuleVersionConflictError,
    );
  });

  it("rolls back when audit persistence fails", async () => {
    const repository = createAdminRepository({ failAudit: true });
    const before = repository.getRule("CargaVendedor");
    const useCase = new UpdateFieldAccessRuleUseCase({ repository });

    await assert.rejects(
      () =>
        useCase.execute({
          active: true,
          canManageAttachments: true,
          currentUserId: "admin-1",
          editableFields: ["solicitud.motivo"],
          editableGroups: [],
          stateCode: "CargaVendedor",
          version: 1,
        }),
      /audit-failed/,
    );

    assert.deepEqual(repository.getRule("CargaVendedor"), before);
  });

  it("makes runtime GET reflect the new persisted rule after update", async () => {
    const repository = createAdminRepository();
    const updateRule = new UpdateFieldAccessRuleUseCase({ repository });

    await updateRule.execute({
      active: true,
      canManageAttachments: true,
      currentUserId: "admin-1",
      editableFields: ["solicitud.motivo"],
      editableGroups: [],
      stateCode: "CargaVendedor",
      version: 1,
    });

    const getSolicitudByIdUseCase = new GetSolicitudByIdUseCase({
      fieldAccessRulesRepository: repository.asRuntimeRepository(),
      repository: createSolicitudRepository(),
    });

    const result = await getSolicitudByIdUseCase.execute({
      currentUser: { id: "user-1", workflowOwnerId: "owner-1" },
      id: "sol-1",
    });

    assert.equal(result.capabilities.fieldAccess.defaultMode, "readonly");
    assert.deepEqual(result.capabilities.fieldAccess.editableFields, [
      "solicitud.motivo",
    ]);
    assert.deepEqual(result.capabilities.fieldAccess.editableGroups, []);
    assert.equal("readonlyReason" in result.capabilities.fieldAccess, false);
  });

  it("makes runtime PATCH validate against the new persisted rule after update", async () => {
    const repository = createAdminRepository();
    const updateRule = new UpdateFieldAccessRuleUseCase({ repository });

    await updateRule.execute({
      active: true,
      canManageAttachments: true,
      currentUserId: "admin-1",
      editableFields: ["solicitud.motivo"],
      editableGroups: [],
      stateCode: "CargaVendedor",
      version: 1,
    });

    const updateSolicitudUseCase = new UpdateSolicitudUseCase({
      simularCuotaSolicitud: { execute: async () => null },
      fieldAccessRulesRepository: repository.asRuntimeRepository(),
      lineasPrestamoCatalog: {
        findByLegacyUserAndOid: async () => null,
      } as never,
      repository: createSolicitudRepository(),
    });

    await assert.rejects(
      () =>
        updateSolicitudUseCase.execute({
          createdBy: "user-1",
          createdByLegacyUser: "seller-1",
          currentUser: { id: "user-1", workflowOwnerId: "owner-1" },
          id: "sol-1",
          titular: { nombre: "Cambio bloqueado" },
        }),
      /FIELD_NOT_EDITABLE_IN_CURRENT_STATE/,
    );
  });
});

type InMemoryOptions = {
  failAudit?: boolean;
  withoutRuleFor?: string;
};

function createAdminRepository(options: InMemoryOptions = {}) {
  const states: WorkflowStateAdminRecord[] = [
    stateRecord("CargaVendedor", "state-1", "owner-1"),
    stateRecord("Revisar", "state-2", "owner-1"),
    stateRecord("Motor", "state-3", "owner-2"),
  ];

  const rules = new Map<string, SolicitudFieldAccessAdminRuleRecord>();
  if (options.withoutRuleFor !== "CargaVendedor") {
    rules.set(
      "state-1",
      ruleRecord("state-1", {
        backgroundColor: "#FF7F7F",
        editableFields: ["solicitud.motivo", "titular.nombre"],
        editableGroups: ["garantias"],
        textColor: "#000000",
        version: 1,
      }),
    );
  }
  if (options.withoutRuleFor !== "Revisar") {
    rules.set(
      "state-2",
      ruleRecord("state-2", {
        backgroundColor: "#FF7F7F",
        editableFields: ["solicitud.motivo", "titular.nombre"],
        editableGroups: ["garantias"],
        textColor: "#000000",
        version: 1,
      }),
    );
  }
  if (options.withoutRuleFor !== "Motor") {
    rules.set(
      "state-3",
      ruleRecord("state-3", {
        active: true,
        editableFields: [],
        editableGroups: [],
        readonlyReason:
          "La solicitud no admite edicion de datos en su estado actual.",
        version: 1,
      }),
    );
  }

  const audits: Array<{
    changedBy: string | null;
    nextValue: unknown;
    previousValue: unknown;
    workflowStateId: string;
  }> = [];

  const repository: SolicitudFieldAccessAdminRepository = {
    findAllStates: async () => states,
    findRuleByWorkflowStateId: async (workflowStateId) =>
      cloneRule(rules.get(workflowStateId) ?? null),
    findStateByCode: async (stateCode) =>
      states.find((state) => state.code === stateCode) ?? null,
    saveRuleWithAudit: async (input: PersistSolicitudFieldAccessRuleInput) => {
      const current = rules.get(input.workflowStateId) ?? null;
      if (!current && input.expectedVersion !== 0) {
        throw new FieldAccessRuleVersionConflictError();
      }
      if (current && current.version !== input.expectedVersion) {
        throw new FieldAccessRuleVersionConflictError();
      }

      const nextVersion = current ? current.version + 1 : 1;
      const nextRule = ruleRecord(input.workflowStateId, {
        active: input.nextRule.active,
        backgroundColor: input.nextRule.backgroundColor,
        canManageAttachments: input.nextRule.canManageAttachments,
        editableFields: [...input.nextRule.editableFields],
        editableGroups: [...input.nextRule.editableGroups],
        readonlyReason: input.nextRule.readonlyReason,
        textColor: input.nextRule.textColor,
        updatedBy: input.updatedBy,
        version: nextVersion,
      });

      if (options.failAudit) {
        throw new Error("audit-failed");
      }

      rules.set(input.workflowStateId, nextRule);
      audits.push({
        changedBy: input.updatedBy,
        nextValue: {
          editableFields: nextRule.editableFields,
          editableGroups: nextRule.editableGroups,
          version: nextRule.version,
        },
        previousValue: current,
        workflowStateId: input.workflowStateId,
      });

      return cloneRule(nextRule)!;
    },
  };

  return {
    ...repository,
    asRuntimeRepository(): SolicitudFieldAccessRulesRepository {
      return {
        findByWorkflowStateId: async (workflowStateId) => {
          const rule = rules.get(workflowStateId);
          if (!rule) {
            return null;
          }

          return {
            active: rule.active,
            backgroundColor: rule.backgroundColor,
            canManageAttachments: rule.canManageAttachments,
            defaultMode: "readonly",
            editableFields: [...rule.editableFields],
            editableGroups: [...rule.editableGroups],
            readonlyReason: rule.readonlyReason,
            textColor: rule.textColor,
            workflowStateId: rule.workflowStateId,
          };
        },
        findByWorkflowStateIds: async (workflowStateIds) => {
          const rulesForStates = workflowStateIds
            .map((workflowStateId) => rules.get(workflowStateId))
            .filter((rule): rule is NonNullable<typeof rule> => rule !== undefined);

          return rulesForStates.map((rule) => ({
            active: rule.active,
            backgroundColor: rule.backgroundColor,
            canManageAttachments: rule.canManageAttachments,
            defaultMode: "readonly" as const,
            editableFields: [...rule.editableFields],
            editableGroups: [...rule.editableGroups],
            readonlyReason: rule.readonlyReason,
            textColor: rule.textColor,
            workflowStateId: rule.workflowStateId,
          }));
        },
      };
    },
    getLastAudit() {
      return audits.at(-1) ?? null;
    },
    getRule(stateCode: string) {
      const state = states.find((item) => item.code === stateCode);
      if (!state) {
        return null;
      }

      return cloneRule(rules.get(state.id) ?? null);
    },
  };
}

function stateRecord(code: string, id: string, ownerId: string): WorkflowStateAdminRecord {
  return {
    code,
    id,
    isActive: true,
    isInitial: code === "CargaVendedor",
    isTerminal: code === "Motor",
    name: code,
    ownerCode: ownerId,
    ownerId,
    ownerName: ownerId,
  };
}

function ruleRecord(
  workflowStateId: string,
  overrides?: Partial<SolicitudFieldAccessAdminRuleRecord>,
): SolicitudFieldAccessAdminRuleRecord {
  return {
    active: true,
    backgroundColor: null,
    canManageAttachments: true,
    defaultMode: "readonly",
    editableFields: [],
    editableGroups: [],
    readonlyReason: null,
    textColor: null,
    updatedAt: new Date("2026-06-04T10:00:00.000Z"),
    updatedBy: "seed",
    version: 1,
    workflowStateId,
    ...overrides,
  };
}

function cloneRule(rule: SolicitudFieldAccessAdminRuleRecord | null) {
  if (!rule) {
    return null;
  }

  return {
    ...rule,
    editableFields: [...rule.editableFields],
    editableGroups: [...rule.editableGroups],
    updatedAt: new Date(rule.updatedAt),
  };
}

function createSolicitudRepository(): SolicitudesCoreRepository {
  return {
    create: async () => {
      throw new Error("not used");
    },
    findById: async () => ({
      conyuge: null,
      createdAt: new Date("2026-05-12T10:00:00.000Z"),
      createdBy: "user-1",
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
      estadoActual: {
        code: "CargaVendedor",
        id: "state-1",
        name: "Carga vendedor",
        ownerId: "owner-1",
      },
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
    }),
    listByOwner: async () => [],
    update: async (_id, patch) => ({
      ...(await createSolicitudRepository().findById("sol-1"))!,
      motivo: patch.solicitud?.motivo ?? "Compra",
    }),
  };
}
