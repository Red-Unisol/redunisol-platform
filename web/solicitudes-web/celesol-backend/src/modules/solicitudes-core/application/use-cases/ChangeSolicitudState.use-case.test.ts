import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SolicitudAdjunto } from "../../adjuntos/domain/entities/SolicitudAdjunto.entity";
import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import type { SolicitudAdjuntoRepository } from "../../adjuntos/domain/repositories/SolicitudAdjuntoRepository";
import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import {
  SolicitudPrestamoLegacyRequiredForWorkflowError,
  SolicitudReciboSueldoAdjuntoRequiredForWorkflowError,
  SolicitudTitularDataIncompleteForConfirmarError,
  SolicitudTitularSocioRequiredForWorkflowError,
} from "../../domain/solicitudes-core-errors";
import { SolicitudWorkflowEngine } from "../../domain/workflow/SolicitudWorkflowEngine";
import { ChangeSolicitudStateUseCase } from "./ChangeSolicitudState.use-case";

describe("ChangeSolicitudStateUseCase", () => {
  it("delegates action, user identity, owner and clock to SolicitudWorkflowEngine", async () => {
    const now = new Date("2026-05-18T12:00:00.000Z");
    let received: Parameters<SolicitudWorkflowEngine["execute"]>[0] | null = null;
    const engineStub = {
      execute: async (input: Parameters<SolicitudWorkflowEngine["execute"]>[0]) => {
        received = input;

        return {
          solicitud: solicitud(),
          transitions: [],
        };
      },
    };
    const useCase = new ChangeSolicitudStateUseCase({
      adjuntoRepository: adjuntoRepository(),
      engine: engineStub as unknown as SolicitudWorkflowEngine,
      now: () => now,
      sociosRepository: socioRepository(),
      solicitudesRepository: solicitudesRepository(),
    });

    await useCase.execute({
      actionCode: "revisar",
      comment: "Falta documentacion",
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      motivo: "Documentacion incompleta",
      solicitudId: "sol-1",
    });

    assert.deepEqual(received, {
      actionCode: "revisar",
      changedBy: "user-1",
      comment: "Falta documentacion",
      motivo: "Documentacion incompleta",
      now,
      solicitudId: "sol-1",
      workflowOwnerId: "owner-1",
    });
  });

  it("rejects workflow execution when the titular does not exist as socio", async () => {
    const useCase = new ChangeSolicitudStateUseCase({
      adjuntoRepository: adjuntoRepository(),
      engine: {
        execute: async () => {
          throw new Error("not used");
        },
      } as unknown as SolicitudWorkflowEngine,
      now: () => new Date("2026-05-18T12:00:00.000Z"),
      sociosRepository: socioRepository({ lookupByDocumento: async () => [] }),
      solicitudesRepository: solicitudesRepository(),
    });

    await assert.rejects(
      () =>
        useCase.execute({
          actionCode: "liquidar",
          currentUser: {
            id: "user-1",
            workflowOwnerId: "owner-1",
          },
          solicitudId: "sol-1",
        }),
      SolicitudTitularSocioRequiredForWorkflowError,
    );
  });

  it("rejects workflow execution when the titular has a socio but no legacyOid yet", async () => {
    const useCase = new ChangeSolicitudStateUseCase({
      adjuntoRepository: adjuntoRepository(),
      engine: {
        execute: async () => {
          throw new Error("not used");
        },
      } as unknown as SolicitudWorkflowEngine,
      now: () => new Date("2026-05-18T12:00:00.000Z"),
      sociosRepository: socioRepository(),
      solicitudesRepository: solicitudesRepository({
        findById: async () => solicitud(),
      }),
    });

    await assert.rejects(
      () =>
        useCase.execute({
          actionCode: "liquidar",
          currentUser: {
            id: "user-1",
            workflowOwnerId: "owner-1",
          },
          solicitudId: "sol-1",
        }),
      SolicitudPrestamoLegacyRequiredForWorkflowError,
    );
  });

  it("allows liquidar to proceed when both the titular socio and legacyOid exist", async () => {
    const now = new Date("2026-05-18T12:00:00.000Z");
    const engineStub = {
      execute: async () => ({
        solicitud: solicitud({ legacyOid: "555000" }),
        transitions: [],
      }),
    };
    const useCase = new ChangeSolicitudStateUseCase({
      adjuntoRepository: adjuntoRepository(),
      engine: engineStub as unknown as SolicitudWorkflowEngine,
      now: () => now,
      sociosRepository: socioRepository(),
      solicitudesRepository: solicitudesRepository({
        findById: async () => solicitud({ legacyOid: "555000" }),
      }),
    });

    await assert.doesNotReject(() =>
      useCase.execute({
        actionCode: "liquidar",
        currentUser: {
          id: "user-1",
          workflowOwnerId: "owner-1",
        },
        solicitudId: "sol-1",
      }),
    );
  });

  it("does not enforce the titular-socio guard for actions other than liquidar", async () => {
    const now = new Date("2026-05-18T12:00:00.000Z");
    let received: Parameters<SolicitudWorkflowEngine["execute"]>[0] | null = null;
    const engineStub = {
      execute: async (input: Parameters<SolicitudWorkflowEngine["execute"]>[0]) => {
        received = input;

        return {
          solicitud: solicitud(),
          transitions: [],
        };
      },
    };
    const useCase = new ChangeSolicitudStateUseCase({
      adjuntoRepository: adjuntoRepository(),
      engine: engineStub as unknown as SolicitudWorkflowEngine,
      now: () => now,
      sociosRepository: socioRepository({ lookupByDocumento: async () => [] }),
      solicitudesRepository: solicitudesRepository(),
    });

    await useCase.execute({
      actionCode: "revisar",
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      solicitudId: "sol-1",
    });

    assert.deepEqual(received, {
      actionCode: "revisar",
      changedBy: "user-1",
      comment: undefined,
      motivo: undefined,
      now,
      solicitudId: "sol-1",
      workflowOwnerId: "owner-1",
    });
  });

  it("allows confirmar to proceed even when the titular does not exist as socio", async () => {
    const now = new Date("2026-05-18T12:00:00.000Z");
    let received: Parameters<SolicitudWorkflowEngine["execute"]>[0] | null = null;
    const engineStub = {
      execute: async (input: Parameters<SolicitudWorkflowEngine["execute"]>[0]) => {
        received = input;

        return {
          solicitud: solicitud(),
          transitions: [],
        };
      },
    };
    const useCase = new ChangeSolicitudStateUseCase({
      adjuntoRepository: adjuntoRepository(),
      engine: engineStub as unknown as SolicitudWorkflowEngine,
      now: () => now,
      sociosRepository: socioRepository({ lookupByDocumento: async () => [] }),
      solicitudesRepository: solicitudesRepository(),
    });

    await useCase.execute({
      actionCode: "confirmar",
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      solicitudId: "sol-1",
    });

    assert.deepEqual(received, {
      actionCode: "confirmar",
      changedBy: "user-1",
      comment: undefined,
      motivo: undefined,
      now,
      solicitudId: "sol-1",
      workflowOwnerId: "owner-1",
    });
  });

  it("rejects confirmar when the titular is missing required data", async () => {
    const useCase = new ChangeSolicitudStateUseCase({
      adjuntoRepository: adjuntoRepository(),
      engine: {
        execute: async () => {
          throw new Error("not used");
        },
      } as unknown as SolicitudWorkflowEngine,
      now: () => new Date("2026-05-18T12:00:00.000Z"),
      sociosRepository: socioRepository(),
      solicitudesRepository: solicitudesRepository({
        findById: async () => ({
          ...solicitud(),
          titular: { ...solicitud().titular, sexo: null },
        }),
      }),
    });

    await assert.rejects(
      () =>
        useCase.execute({
          actionCode: "confirmar",
          currentUser: {
            id: "user-1",
            workflowOwnerId: "owner-1",
          },
          solicitudId: "sol-1",
        }),
      SolicitudTitularDataIncompleteForConfirmarError,
    );
  });

  it("does not enforce the titular-required-data guard for actions other than confirmar", async () => {
    const now = new Date("2026-05-18T12:00:00.000Z");
    let received: Parameters<SolicitudWorkflowEngine["execute"]>[0] | null = null;
    const engineStub = {
      execute: async (input: Parameters<SolicitudWorkflowEngine["execute"]>[0]) => {
        received = input;

        return {
          solicitud: solicitud(),
          transitions: [],
        };
      },
    };
    const useCase = new ChangeSolicitudStateUseCase({
      adjuntoRepository: adjuntoRepository(),
      engine: engineStub as unknown as SolicitudWorkflowEngine,
      now: () => now,
      sociosRepository: socioRepository(),
      solicitudesRepository: solicitudesRepository({
        findById: async () => ({
          ...solicitud(),
          titular: { ...solicitud().titular, sexo: null },
        }),
      }),
    });

    await useCase.execute({
      actionCode: "revisar",
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      solicitudId: "sol-1",
    });

    assert.deepEqual(received, {
      actionCode: "revisar",
      changedBy: "user-1",
      comment: undefined,
      motivo: undefined,
      now,
      solicitudId: "sol-1",
      workflowOwnerId: "owner-1",
    });
  });

  it("still enforces the titular-required-data guard for a system admin actor", async () => {
    const useCase = new ChangeSolicitudStateUseCase({
      adjuntoRepository: adjuntoRepository(),
      engine: {
        execute: async () => {
          throw new Error("not used");
        },
      } as unknown as SolicitudWorkflowEngine,
      now: () => new Date("2026-05-18T12:00:00.000Z"),
      sociosRepository: socioRepository(),
      solicitudesRepository: solicitudesRepository({
        findById: async () => ({
          ...solicitud(),
          titular: { ...solicitud().titular, sexo: null },
        }),
      }),
    });

    await assert.rejects(
      () =>
        useCase.execute({
          actionCode: "confirmar",
          currentUser: {
            id: "admin-1",
            isSystemAdmin: true,
            workflowOwnerId: "",
          },
          solicitudId: "sol-1",
        }),
      SolicitudTitularDataIncompleteForConfirmarError,
    );
  });

  it("forwards isSystemAdmin to SolicitudWorkflowEngine when the actor is a system admin", async () => {
    const now = new Date("2026-05-18T12:00:00.000Z");
    let received: Parameters<SolicitudWorkflowEngine["execute"]>[0] | null = null;
    const engineStub = {
      execute: async (input: Parameters<SolicitudWorkflowEngine["execute"]>[0]) => {
        received = input;

        return {
          solicitud: solicitud({ legacyOid: "555000" }),
          transitions: [],
        };
      },
    };
    const useCase = new ChangeSolicitudStateUseCase({
      adjuntoRepository: adjuntoRepository(),
      engine: engineStub as unknown as SolicitudWorkflowEngine,
      now: () => now,
      sociosRepository: socioRepository(),
      solicitudesRepository: solicitudesRepository({
        findById: async () => solicitud({ legacyOid: "555000" }),
      }),
    });

    await useCase.execute({
      actionCode: "liquidar",
      currentUser: {
        id: "admin-1",
        isSystemAdmin: true,
        workflowOwnerId: "",
      },
      solicitudId: "sol-1",
    });

    assert.deepEqual(received, {
      actionCode: "liquidar",
      changedBy: "admin-1",
      comment: undefined,
      isSystemAdmin: true,
      motivo: undefined,
      now,
      solicitudId: "sol-1",
      workflowOwnerId: "",
    });
  });

  it("still enforces the titular-socio guard for a system admin actor", async () => {
    const useCase = new ChangeSolicitudStateUseCase({
      adjuntoRepository: adjuntoRepository(),
      engine: {
        execute: async () => {
          throw new Error("not used");
        },
      } as unknown as SolicitudWorkflowEngine,
      now: () => new Date("2026-05-18T12:00:00.000Z"),
      sociosRepository: socioRepository({ lookupByDocumento: async () => [] }),
      solicitudesRepository: solicitudesRepository(),
    });

    await assert.rejects(
      () =>
        useCase.execute({
          actionCode: "liquidar",
          currentUser: {
            id: "admin-1",
            isSystemAdmin: true,
            workflowOwnerId: "",
          },
          solicitudId: "sol-1",
        }),
      SolicitudTitularSocioRequiredForWorkflowError,
    );
  });

  it("rejects workflow execution when there is no recibo de sueldo adjunto", async () => {
    const useCase = new ChangeSolicitudStateUseCase({
      adjuntoRepository: adjuntoRepository({
        listBySolicitudId: async () => [],
      }),
      engine: {
        execute: async () => {
          throw new Error("not used");
        },
      } as unknown as SolicitudWorkflowEngine,
      now: () => new Date("2026-05-18T12:00:00.000Z"),
      sociosRepository: socioRepository(),
      solicitudesRepository: solicitudesRepository(),
    });

    await assert.rejects(
      () =>
        useCase.execute({
          actionCode: "enviar",
          currentUser: {
            id: "user-1",
            workflowOwnerId: "owner-1",
          },
          solicitudId: "sol-1",
        }),
      SolicitudReciboSueldoAdjuntoRequiredForWorkflowError,
    );
  });

  it("does not enforce the recibo-de-sueldo guard for actions other than enviar", async () => {
    const now = new Date("2026-05-18T12:00:00.000Z");
    let received: Parameters<SolicitudWorkflowEngine["execute"]>[0] | null = null;
    const engineStub = {
      execute: async (input: Parameters<SolicitudWorkflowEngine["execute"]>[0]) => {
        received = input;

        return {
          solicitud: solicitud(),
          transitions: [],
        };
      },
    };
    const useCase = new ChangeSolicitudStateUseCase({
      adjuntoRepository: adjuntoRepository({
        listBySolicitudId: async () => [],
      }),
      engine: engineStub as unknown as SolicitudWorkflowEngine,
      now: () => now,
      sociosRepository: socioRepository(),
      solicitudesRepository: solicitudesRepository(),
    });

    await useCase.execute({
      actionCode: "revisar",
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      solicitudId: "sol-1",
    });

    assert.deepEqual(received, {
      actionCode: "revisar",
      changedBy: "user-1",
      comment: undefined,
      motivo: undefined,
      now,
      solicitudId: "sol-1",
      workflowOwnerId: "owner-1",
    });
  });

  it("still enforces the recibo-de-sueldo guard for a system admin actor", async () => {
    const useCase = new ChangeSolicitudStateUseCase({
      adjuntoRepository: adjuntoRepository({
        listBySolicitudId: async () => [],
      }),
      engine: {
        execute: async () => {
          throw new Error("not used");
        },
      } as unknown as SolicitudWorkflowEngine,
      now: () => new Date("2026-05-18T12:00:00.000Z"),
      sociosRepository: socioRepository(),
      solicitudesRepository: solicitudesRepository(),
    });

    await assert.rejects(
      () =>
        useCase.execute({
          actionCode: "enviar",
          currentUser: {
            id: "admin-1",
            isSystemAdmin: true,
            workflowOwnerId: "",
          },
          solicitudId: "sol-1",
        }),
      SolicitudReciboSueldoAdjuntoRequiredForWorkflowError,
    );
  });

  it("annotates liquidar with blockedReason on the transitions returned after executing a transition", async () => {
    const engineStub = {
      execute: async () => ({
        solicitud: solicitud(),
        transitions: [
          workflowTransition({ actionCode: "desestimar" }),
          workflowTransition({ actionCode: "liquidar" }),
        ],
      }),
    };
    const useCase = new ChangeSolicitudStateUseCase({
      adjuntoRepository: adjuntoRepository(),
      engine: engineStub as unknown as SolicitudWorkflowEngine,
      now: () => new Date("2026-05-18T12:00:00.000Z"),
      sociosRepository: socioRepository({ lookupByDocumento: async () => [] }),
      solicitudesRepository: solicitudesRepository(),
    });

    const result = await useCase.execute({
      actionCode: "confirmar",
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      solicitudId: "sol-1",
    });

    assert.deepEqual(
      result.transitions.map((transition) => ({
        actionCode: transition.actionCode,
        blockedReason: transition.blockedReason,
      })),
      [
        { actionCode: "desestimar", blockedReason: null },
        {
          actionCode: "liquidar",
          blockedReason:
            "Debe existir un socio creado para iniciar el flujo de la solicitud.",
        },
      ],
    );
  });
});

function workflowTransition(
  overrides: Partial<{
    actionCode: string;
    actionLabel: string;
    blockedReason: string | null;
  }> = {},
) {
  return {
    actionCode: "desestimar",
    actionLabel: "Desestimar",
    blockedReason: null,
    defaultComment: null,
    description: null,
    fromStateId: "state-4",
    id: "transition-1",
    requiresComment: false,
    saveAndExit: false,
    sortOrder: 1,
    toState: {
      code: "Desestimada",
      id: "state-5",
      name: "Desestimada",
      owner: { code: "HISTORIAL", id: "owner-3", name: "Historial" },
    },
    ...overrides,
  };
}

function solicitud(overrides: Partial<SolicitudCore> = {}): SolicitudCore {
  return {
    ...baseSolicitud(),
    ...overrides,
  };
}

function baseSolicitud(): SolicitudCore {
  return {
    id: "sol-1",
    createdAt: new Date("2026-05-18T10:00:00.000Z"),
    createdBy: "user-1",
    cuotaResultante: null,
    cuotas: null,
    ejecutivoSolicitud: null,
    estadoActual: {
      code: "RevisionRiesgo",
      id: "state-2",
      name: "Revision riesgo",
      ownerId: "owner-2",
    },
    firmaDigitalmente: false,
    legacyOid: null,
    lineaPrestamoDescripcion: "Personal",
    lineaPrestamoLegacyOid: "LP-1",
    montoAFinanciar: null,
    motivo: null,
    nroSolicitud: null,
    observaciones: null,
    garantias: [],
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
    titular: {
      apellidoDenominacion: "Perez",
      cbu: null,
      celular: "1199999999",
      cuit: "20-33344455-9",
      domicilioCalle: null,
      email: "juan@example.com",
      fechaNacimiento: "1990-05-20",
      localidad: null,
      nombre: "Juan",
      nroDocumento: "33.344.455",
      nroPuerta: null,
      nroSocio: null,
      sexo: "M",
      tipoDocumento: "DNI",
    },
    updatedAt: new Date("2026-05-18T10:00:00.000Z"),
    vendedorSolicitud: null,
  };
}

function adjuntoRepository(
  overrides: Partial<SolicitudAdjuntoRepository> = {},
): SolicitudAdjuntoRepository {
  return {
    create: async () => {
      throw new Error("not used");
    },
    createMany: async () => {
      throw new Error("not used");
    },
    findById: async () => null,
    listBySolicitudId: async () => [reciboSueldoAdjunto()],
    softDelete: async () => {
      throw new Error("not used");
    },
    update: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}

function reciboSueldoAdjunto(
  overrides: Partial<SolicitudAdjunto> = {},
): SolicitudAdjunto {
  return {
    id: "adjunto-1",
    solicitudId: "sol-1",
    archivoNombre: "recibo.pdf",
    archivoPath: "solicitudes/sol-1/recibo.pdf",
    archivoMimeType: "application/pdf",
    archivoSizeBytes: 1024,
    storageBucket: "celesol-adjuntos",
    tipoAdjunto: "Recibo de Sueldo",
    estadoAdjunto: null,
    descripcion: null,
    adicional: null,
    comentario: null,
    nroDocumento: null,
    restringido: false,
    uploadedBy: "user-1",
    uploadedByName: "Vendedor Uno",
    uploadedAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    ...overrides,
  };
}

function socioRepository(
  overrides: Partial<SocioRepository> = {},
): SocioRepository {
  return {
    create: async () => {
      throw new Error("not used");
    },
    delete: async () => {
      throw new Error("not used");
    },
    findByCuit: async () => null,
    findByDocumento: async () => null,
    findById: async () => null,
    list: async () => [],
    lookupByDocumento: async () => [
      {
        apellido: "Perez",
        celular: null,
        createdAt: new Date(),
        cuit: "20333444559",
        domicilioCalle: null,
        domicilioCodigoPostal: null,
        domicilioLocalidad: null,
        domicilioNroPuerta: null,
        email: null,
        fechaDeNacimiento: new Date("1990-01-01T00:00:00.000Z"),
        id: "socio-1",
        nombre: "Juan",
        nroDocumento: "33344455",
        nroSocioLegacy: null,
        razonSocial: null,
        sexo: "M",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
        updatedAt: new Date(),
      },
    ],
    update: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}

function solicitudesRepository(
  overrides: Partial<SolicitudesCoreRepository> = {},
): SolicitudesCoreRepository {
  return {
    create: async () => {
      throw new Error("not used");
    },
    findById: async () => solicitud(),
    listByOwner: async () => [],
    update: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}
