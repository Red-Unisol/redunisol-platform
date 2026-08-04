import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import type { SolicitudFieldAccessRulesRepository } from "../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type {
  ListSolicitudesByOwnerInput,
  ListSolicitudesTrackingInput,
  SolicitudesCoreRepository,
} from "../../domain/repositories/SolicitudesCoreRepository";
import { ListSolicitudesUseCase } from "./ListSolicitudes.use-case";

describe("ListSolicitudesUseCase", () => {
  it("lists work solicitudes scoped to the current workflow owner and forwards filters", async () => {
    let receivedInput: ListSolicitudesByOwnerInput | null = null;
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listByOwner: async (input) => {
        receivedInput = input;
        return [];
      },
      listTracking: async () => {
        throw new Error("not used");
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new ListSolicitudesUseCase({
      fieldAccessRulesRepository: buildFieldAccessRulesRepository(),
      repository,
    });

    const result = await useCase.execute({
      workflowOwnerId: "owner-1",
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      createdFrom: "2026-05-01",
      createdTo: "2026-05-31",
      excludeEstado: "CargaVendedor",
      estado: "CargaVendedor",
      limit: 20,
      nroDocumento: "33344455",
      offset: 40,
      scope: "work",
    });

    assert.deepEqual(receivedInput, {
      workflowOwnerId: "owner-1",
      createdFrom: "2026-05-01",
      createdTo: "2026-05-31",
      excludeEstado: "CargaVendedor",
      estado: "CargaVendedor",
      limit: 20,
      nroDocumento: "33344455",
      offset: 40,
    });
    assert.deepEqual(result, []);
  });

  it("lists tracking solicitudes by current user without requiring current owner", async () => {
    let receivedInput: ListSolicitudesTrackingInput | null = null;
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listByOwner: async () => {
        throw new Error("not used");
      },
      listTracking: async (input) => {
        receivedInput = input;
        return [
          solicitudCore({
            createdBy: "creator-1",
            estadoActual: {
              code: "Analisis",
              id: "state-2",
              name: "Analisis",
              ownerId: "owner-2",
            },
            participants: [
              {
                userId: "user-1",
              },
            ],
          }),
        ];
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new ListSolicitudesUseCase({
      fieldAccessRulesRepository: buildFieldAccessRulesRepository(),
      repository,
    });

    const result = await useCase.execute({
      currentUser: {
        id: "user-1",
        workflowOwnerId: null,
      },
      createdFrom: "2026-05-01",
      createdTo: "2026-05-31",
      excludeEstado: "CargaVendedor",
      limit: 20,
      nroDocumento: "33344455",
      offset: 40,
      scope: "tracking",
    });

    assert.deepEqual(receivedInput, {
      createdFrom: "2026-05-01",
      createdTo: "2026-05-31",
      excludeEstado: "CargaVendedor",
      limit: 20,
      nroDocumento: "33344455",
      offset: 40,
      userId: "user-1",
    });
    assert.deepEqual(result[0]?.capabilities, {
      canChangeState: false,
      canDeleteAdjuntos: false,
      canDownloadAdjuntos: true,
      canEdit: false,
      canManageCancelaciones: false,
      canUploadAdjuntos: false,
      canView: true,
      canViewHistory: true,
    });
  });

  it("keeps previous behavior when excludeEstado is not provided", async () => {
    let receivedInput: ListSolicitudesTrackingInput | null = null;
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listByOwner: async () => {
        throw new Error("not used");
      },
      listTracking: async (input) => {
        receivedInput = input;
        return [];
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new ListSolicitudesUseCase({
      fieldAccessRulesRepository: buildFieldAccessRulesRepository(),
      repository,
    });

    await useCase.execute({
      currentUser: {
        id: "user-1",
        workflowOwnerId: null,
      },
      createdFrom: "2026-05-01",
      createdTo: "2026-05-31",
      limit: 20,
      nroDocumento: "33344455",
      offset: 40,
      scope: "tracking",
    });

    assert.deepEqual(receivedInput, {
      createdFrom: "2026-05-01",
      createdTo: "2026-05-31",
      limit: 20,
      nroDocumento: "33344455",
      offset: 40,
      userId: "user-1",
    });
  });

  it("scope work never delegates creator or participant filters", async () => {
    let trackingCalled = false;
    let receivedInput: ListSolicitudesByOwnerInput | null = null;
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listByOwner: async (input) => {
        receivedInput = input;
        return [];
      },
      listTracking: async () => {
        trackingCalled = true;
        return [];
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new ListSolicitudesUseCase({ repository });

    await useCase.execute({
      currentUser: {
        id: "creator-user",
        workflowOwnerId: "owner-a",
      },
      limit: 10,
      offset: 0,
      scope: "work",
      workflowOwnerId: "owner-a",
    });

    assert.equal(trackingCalled, false);
    if (!receivedInput) {
      throw new Error("expected work input");
    }
    const workInput = receivedInput as ListSolicitudesByOwnerInput;
    assert.equal(workInput.workflowOwnerId, "owner-a");
    assert.equal("userId" in workInput, false);
  });

  it("keeps an empty workflow owner filter for a non-admin user without a workflow owner", async () => {
    let receivedInput: ListSolicitudesByOwnerInput | null = null;
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listByOwner: async (input) => {
        receivedInput = input;
        return [];
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new ListSolicitudesUseCase({ repository });

    await useCase.execute({
      currentUser: {
        id: "user-1",
        workflowOwnerId: null,
      },
      limit: 10,
      offset: 0,
      scope: "work",
    });

    if (!receivedInput) {
      throw new Error("expected work input");
    }
    const workInput = receivedInput as ListSolicitudesByOwnerInput;
    assert.equal(workInput.workflowOwnerId, "");
  });

  it("omits the workflow owner filter for a system admin without an explicit owner", async () => {
    let receivedInput: ListSolicitudesByOwnerInput | null = null;
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listByOwner: async (input) => {
        receivedInput = input;
        return [];
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new ListSolicitudesUseCase({ repository });

    await useCase.execute({
      currentUser: {
        id: "admin-1",
        isSystemAdmin: true,
        workflowOwnerId: null,
      },
      limit: 10,
      offset: 0,
      scope: "work",
    });

    if (!receivedInput) {
      throw new Error("expected work input");
    }
    const workInput = receivedInput as ListSolicitudesByOwnerInput;
    assert.equal(workInput.workflowOwnerId, undefined);
  });

  it("scope tracking never delegates workflow owner filter", async () => {
    let workCalled = false;
    let receivedInput: ListSolicitudesTrackingInput | null = null;
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listByOwner: async () => {
        workCalled = true;
        return [];
      },
      listTracking: async (input) => {
        receivedInput = input;
        return [];
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new ListSolicitudesUseCase({ repository });

    await useCase.execute({
      currentUser: {
        id: "tracking-user",
        workflowOwnerId: "owner-a",
      },
      limit: 10,
      offset: 0,
      scope: "tracking",
    });

    assert.equal(workCalled, false);
    if (!receivedInput) {
      throw new Error("expected tracking input");
    }
    const trackingInput = receivedInput as ListSolicitudesTrackingInput;
    assert.equal(trackingInput.userId, "tracking-user");
    assert.equal("workflowOwnerId" in trackingInput, false);
  });

  it("scope recientes always uses recientes listing without owner filtering", async () => {
    let recientesInput: { excludeEstado?: string } | null = null;
    let workCalled = false;
    let trackingCalled = false;
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listByOwner: async () => {
        workCalled = true;
        return [];
      },
      listRecientes: async (input) => {
        recientesInput = input;
        return [];
      },
      listTracking: async () => {
        trackingCalled = true;
        return [];
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new ListSolicitudesUseCase({ repository });

    await useCase.execute({
      currentUser: {
        id: "seller-1",
        workflowOwnerId: "owner-vendedores",
      },
      limit: 10,
      offset: 0,
      scope: "recientes",
    });

    assert.equal(workCalled, false);
    assert.equal(trackingCalled, false);
    if (!recientesInput) {
      throw new Error("expected recientes input");
    }
    const resolvedRecientesInput = recientesInput as {
      excludeEstado: string;
    };
    assert.equal(resolvedRecientesInput.excludeEstado, "CargaVendedor");
  });

  it("scope recientes includes solicitudes from other owners while keeping non-operational capabilities", async () => {
    let receivedInput:
      | {
          excludeEstado?: string;
          limit: number;
          nroDocumento?: string;
          offset: number;
        }
      | null = null;
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listByOwner: async () => {
        throw new Error("not used");
      },
      listRecientes: async (input) => {
        receivedInput = input;
        return [
          solicitudCore({
            estadoActual: {
              code: "RevisionRiesgo",
              id: "state-riesgo",
              name: "Revision riesgo",
              ownerId: "owner-riesgo",
            },
            id: "sol-riesgo",
          }),
          solicitudCore({
            estadoActual: {
              code: "CargaVendedor",
              id: "state-vendedor",
              name: "Carga vendedor",
              ownerId: "owner-vendedores",
            },
            id: "sol-vendedores",
          }),
        ];
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new ListSolicitudesUseCase({
      fieldAccessRulesRepository: buildFieldAccessRulesRepository(),
      repository,
    });

    const result = await useCase.execute({
      currentUser: {
        id: "risk-1",
        workflowOwnerId: "owner-riesgo",
      },
      limit: 25,
      nroDocumento: "33344455",
      offset: 50,
      scope: "recientes",
    });

    assert.deepEqual(receivedInput, {
      createdFrom: undefined,
      createdTo: undefined,
      excludeEstado: "CargaVendedor",
      limit: 25,
      nroDocumento: "33344455",
      offset: 50,
    });
    assert.equal(result.length, 2);
    assert.deepEqual(result[0]?.capabilities, {
      canChangeState: true,
      canDeleteAdjuntos: true,
      canDownloadAdjuntos: true,
      canEdit: true,
      canManageCancelaciones: true,
      canUploadAdjuntos: true,
      canView: true,
      canViewHistory: true,
    });
    assert.deepEqual(result[1]?.capabilities, {
      canChangeState: false,
      canDeleteAdjuntos: false,
      canDownloadAdjuntos: true,
      canEdit: false,
      canManageCancelaciones: false,
      canUploadAdjuntos: false,
      canView: true,
      canViewHistory: true,
    });
  });

  it("scope recientes respects excludeEstado when it is explicitly provided", async () => {
    let receivedInput: { excludeEstado?: string } | null = null;
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listByOwner: async () => {
        throw new Error("not used");
      },
      listRecientes: async (input) => {
        receivedInput = input;
        return [];
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new ListSolicitudesUseCase({ repository });

    await useCase.execute({
      currentUser: {
        id: "risk-1",
        workflowOwnerId: "owner-riesgo",
      },
      limit: 10,
      offset: 0,
      scope: "recientes",
      excludeEstado: "Motor",
    });

    if (!receivedInput) {
      throw new Error("expected tracking input");
    }
    const recientesInput = receivedInput as { excludeEstado?: string };
    assert.equal(recientesInput.excludeEstado, "Motor");
  });

  it("scope recientes does not require workflow owner assignment", async () => {
    let receivedInput: { excludeEstado?: string } | null = null;
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listByOwner: async () => {
        throw new Error("not used");
      },
      listRecientes: async (input) => {
        receivedInput = input;
        return [];
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new ListSolicitudesUseCase({ repository });

    await useCase.execute({
      currentUser: {
        id: "other-1",
        workflowOwnerId: null,
      },
      limit: 10,
      offset: 0,
      scope: "recientes",
    });

    if (!receivedInput) {
      throw new Error("expected tracking input");
    }
    const recientesInput = receivedInput as { excludeEstado?: string };
    assert.equal(recientesInput.excludeEstado, "CargaVendedor");
  });

  it("scope historicas delegates to historicas listing without workflow owner filter", async () => {
    let historicasCalled = false;
    let workCalled = false;
    let trackingCalled = false;
    let recientesCalled = false;
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listByOwner: async () => {
        workCalled = true;
        return [];
      },
      listHistoricas: async () => {
        historicasCalled = true;
        return [];
      },
      listRecientes: async () => {
        recientesCalled = true;
        return [];
      },
      listTracking: async () => {
        trackingCalled = true;
        return [];
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new ListSolicitudesUseCase({ repository });

    await useCase.execute({
      currentUser: {
        id: "hist-1",
        workflowOwnerId: null,
      },
      limit: 10,
      offset: 0,
      scope: "historicas",
    });

    assert.equal(historicasCalled, true);
    assert.equal(workCalled, false);
    assert.equal(trackingCalled, false);
    assert.equal(recientesCalled, false);
  });

  it("scope historicas keeps capabilities based on current owner", async () => {
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listByOwner: async () => {
        throw new Error("not used");
      },
      listHistoricas: async () => [
        solicitudCore({
          estadoActual: {
            code: "Rechazada",
            id: "state-h-1",
            name: "Rechazada",
            ownerId: "owner-historial",
          },
        }),
      ],
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new ListSolicitudesUseCase({
      fieldAccessRulesRepository: buildFieldAccessRulesRepository(),
      repository,
    });

    const result = await useCase.execute({
      currentUser: {
        id: "risk-1",
        workflowOwnerId: "owner-riesgo",
      },
      limit: 10,
      offset: 0,
      scope: "historicas",
    });

    assert.deepEqual(result[0]?.capabilities, {
      canChangeState: false,
      canDeleteAdjuntos: false,
      canDownloadAdjuntos: true,
      canEdit: false,
      canManageCancelaciones: false,
      canUploadAdjuntos: false,
      canView: true,
      canViewHistory: true,
    });
    assert.deepEqual(result[0]?.appearance, {
      backgroundColor: "#FF7F7F",
      textColor: "#000000",
    });
  });

  it("resolves appearance once per unique workflow state id", async () => {
    const batchCalls: string[][] = [];
    let singleCalls = 0;
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listByOwner: async () => {
        throw new Error("not used");
      },
      listHistoricas: async () => [
        solicitudCore({
          estadoActual: {
            code: "Rechazada",
            id: "state-rechazada",
            name: "Rechazada",
            ownerId: "owner-historial",
          },
          id: "sol-1",
        }),
        solicitudCore({
          estadoActual: {
            code: "Rechazada",
            id: "state-rechazada",
            name: "Rechazada",
            ownerId: "owner-historial",
          },
          id: "sol-2",
        }),
        solicitudCore({
          estadoActual: {
            code: "PreAprobada",
            id: "state-preaprobada",
            name: "PreAprobada",
            ownerId: "owner-historial",
          },
          id: "sol-3",
        }),
      ],
      update: async () => {
        throw new Error("not used");
      },
    };
    const fieldAccessRulesRepository: SolicitudFieldAccessRulesRepository = {
      findByWorkflowStateId: async () => {
        singleCalls += 1;
        throw new Error("should not use per-state lookup in list use case");
      },
      findByWorkflowStateIds: async (workflowStateIds) => {
        batchCalls.push([...workflowStateIds]);

        return workflowStateIds.map((workflowStateId) =>
          workflowStateId === "state-rechazada"
            ? {
                active: true,
                backgroundColor: "#FF7F7F",
                canManageAttachments: true,
                defaultMode: "readonly",
                editableFields: [],
                editableGroups: [],
                readonlyReason: null,
                textColor: "#000000",
                workflowStateId,
              }
            : {
                active: true,
                backgroundColor: "#C0FFFF",
                canManageAttachments: true,
                defaultMode: "readonly",
                editableFields: [],
                editableGroups: [],
                readonlyReason: null,
                textColor: "#000000",
                workflowStateId,
              },
        );
      },
    };
    const useCase = new ListSolicitudesUseCase({
      fieldAccessRulesRepository,
      repository,
    });

    const result = await useCase.execute({
      currentUser: {
        id: "risk-1",
        workflowOwnerId: "owner-riesgo",
      },
      limit: 10,
      offset: 0,
      scope: "historicas",
    });

    assert.deepEqual(batchCalls, [["state-rechazada", "state-preaprobada"]]);
    assert.equal(singleCalls, 0);
    assert.deepEqual(result.map((item) => item.appearance), [
      { backgroundColor: "#FF7F7F", textColor: "#000000" },
      { backgroundColor: "#FF7F7F", textColor: "#000000" },
      { backgroundColor: "#C0FFFF", textColor: "#000000" },
    ]);
  });

  it("keeps null appearance when a workflow state has no active rule", async () => {
    let batchCalls = 0;
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listHistoricas: async () => [
        solicitudCore({
          estadoActual: {
            code: "CargaVendedor",
            id: "state-sin-regla",
            name: "Carga vendedor",
            ownerId: "owner-vendedores",
          },
        }),
      ],
      listByOwner: async () => {
        throw new Error("not used");
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new ListSolicitudesUseCase({
      fieldAccessRulesRepository: {
        findByWorkflowStateId: async () => {
          throw new Error("should not use per-state lookup in list use case");
        },
        findByWorkflowStateIds: async () => {
          batchCalls += 1;
          return [];
        },
      },
      repository,
    });

    const result = await useCase.execute({
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-vendedores",
      },
      limit: 10,
      offset: 0,
      scope: "historicas",
    });

    assert.equal(batchCalls, 1);
    assert.deepEqual(result[0]?.appearance, {
      backgroundColor: null,
      textColor: null,
    });
  });

  it("does not query appearance rules when the listing is empty", async () => {
    let batchCalls = 0;
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listHistoricas: async () => [],
      listByOwner: async () => {
        throw new Error("not used");
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new ListSolicitudesUseCase({
      fieldAccessRulesRepository: {
        findByWorkflowStateId: async () => {
          throw new Error("should not use per-state lookup in list use case");
        },
        findByWorkflowStateIds: async () => {
          batchCalls += 1;
          return [];
        },
      },
      repository,
    });

    const result = await useCase.execute({
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-vendedores",
      },
      limit: 10,
      offset: 0,
      scope: "historicas",
    });

    assert.equal(batchCalls, 0);
    assert.deepEqual(result, []);
  });
});

function buildFieldAccessRulesRepository(overrides?: {
  findByWorkflowStateId?: SolicitudFieldAccessRulesRepository["findByWorkflowStateId"];
  findByWorkflowStateIds?: SolicitudFieldAccessRulesRepository["findByWorkflowStateIds"];
}): SolicitudFieldAccessRulesRepository {
  return {
    findByWorkflowStateId:
      overrides?.findByWorkflowStateId ??
      (async (workflowStateId) => {
        switch (workflowStateId) {
          case "state-h-1":
          case "state-rechazada":
            return {
              active: true,
              backgroundColor: "#FF7F7F",
              canManageAttachments: true,
              defaultMode: "readonly",
              editableFields: [],
              editableGroups: [],
              readonlyReason: null,
              textColor: "#000000",
              workflowStateId,
            };
          case "state-preaprobada":
            return {
              active: true,
              backgroundColor: "#C0FFFF",
              canManageAttachments: true,
              defaultMode: "readonly",
              editableFields: [],
              editableGroups: [],
              readonlyReason: null,
              textColor: "#000000",
              workflowStateId,
            };
          default:
            return {
              active: true,
              backgroundColor: null,
              canManageAttachments: true,
              defaultMode: "readonly",
              editableFields: [],
              editableGroups: [],
              readonlyReason: null,
              textColor: null,
              workflowStateId,
            };
        }
      }),
    findByWorkflowStateIds:
      overrides?.findByWorkflowStateIds ??
      (async (workflowStateIds) => {
        const records = await Promise.all(
          workflowStateIds.map((workflowStateId) =>
            buildFieldAccessRulesRepository().findByWorkflowStateId(
              workflowStateId,
            ),
          ),
        );

        return records.filter(
          (record): record is NonNullable<typeof record> => record !== null,
        );
      }),
  };
}

function solicitudCore(overrides: Partial<SolicitudCore> = {}): SolicitudCore {
  return {
    conyuge: null,
    createdAt: new Date("2026-05-12T10:00:00.000Z"),
    createdBy: "creator-1",
    cuotaResultante: null,
    cuotas: null,
    cupoTitular: null,
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
    ejecutivoSolicitud: null,
    estadoActual: {
      code: "CargaVendedor",
      id: "state-1",
      name: "Carga vendedor",
      ownerId: "owner-1",
    },
    firmaDigitalmente: false,
    garantias: [],
    id: "sol-1",
    legacyOid: null,
    lineaPrestamoDescripcion: "Personal",
    lineaPrestamoLegacyOid: "LP-1",
    montoAFinanciar: null,
    motivo: null,
    nroSolicitud: null,
    observaciones: null,
    titular: {
      apellidoDenominacion: "Perez",
      cbu: null,
      celular: null,
      cuit: null,
      domicilioCalle: null,
      email: null,
      localidad: null,
      nombre: "Juan",
      nroDocumento: "33344455",
      nroPuerta: null,
      nroSocio: null,
      tipoDocumento: "DNI",
    },
    updatedAt: new Date("2026-05-12T10:00:00.000Z"),
    vendedorSolicitud: "Elias Gallay",
    ...overrides,
  };
}

