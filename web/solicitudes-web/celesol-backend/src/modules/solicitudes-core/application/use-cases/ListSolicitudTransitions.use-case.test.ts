import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { SolicitudWorkflowRepository } from "../../domain/repositories/SolicitudWorkflowRepository";
import { ListSolicitudTransitionsUseCase } from "./ListSolicitudTransitions.use-case";

describe("ListSolicitudTransitionsUseCase", () => {
  it("delegates solicitud id and workflow owner to the repository", async () => {
    let received:
      | Parameters<SolicitudWorkflowRepository["listAvailableTransitions"]>[0]
      | null = null;
    const repository: SolicitudWorkflowRepository = {
      executeWorkflowPlan: async () => {
        throw new Error("not used");
      },
      listAvailableTransitions: async (input) => {
        received = input;

        return [];
      },
      listHistory: async () => [],
    };
    const useCase = new ListSolicitudTransitionsUseCase({
      repository,
      sociosRepository: socioRepository(),
      solicitudesRepository: solicitudesRepository(),
    });

    await useCase.execute({
      solicitudId: "sol-1",
      workflowOwnerId: "owner-1",
    });

    assert.deepEqual(received, {
      solicitudId: "sol-1",
      workflowOwnerId: "owner-1",
    });
  });

  it("forwards isSystemAdmin to the repository when listing transitions", async () => {
    let received:
      | Parameters<SolicitudWorkflowRepository["listAvailableTransitions"]>[0]
      | null = null;
    const repository: SolicitudWorkflowRepository = {
      executeWorkflowPlan: async () => {
        throw new Error("not used");
      },
      listAvailableTransitions: async (input) => {
        received = input;

        return [];
      },
      listHistory: async () => [],
    };
    const useCase = new ListSolicitudTransitionsUseCase({
      repository,
      sociosRepository: socioRepository(),
      solicitudesRepository: solicitudesRepository(),
    });

    await useCase.execute({
      isSystemAdmin: true,
      solicitudId: "sol-1",
      workflowOwnerId: "",
    });

    assert.deepEqual(received, {
      isSystemAdmin: true,
      solicitudId: "sol-1",
      workflowOwnerId: "",
    });
  });

  it("annotates the liquidar transition with blockedReason when the titular does not exist as socio", async () => {
    const repository: SolicitudWorkflowRepository = {
      executeWorkflowPlan: async () => {
        throw new Error("not used");
      },
      listAvailableTransitions: async () => [
        {
          actionCode: "desestimar",
          actionLabel: "Desestimar",
          blockedReason: null,
          defaultComment: null,
          description: null,
          fromStateId: "state-4",
          id: "transition-1",
          requiresComment: true,
          saveAndExit: false,
          sortOrder: 1,
          toState: {
            code: "Desestimada",
            id: "state-5",
            name: "Desestimada",
            owner: { code: "HISTORIAL", id: "owner-3", name: "Historial" },
          },
        },
        {
          actionCode: "liquidar",
          actionLabel: "Liquidar",
          blockedReason: null,
          defaultComment: null,
          description: null,
          fromStateId: "state-4",
          id: "transition-2",
          requiresComment: false,
          saveAndExit: false,
          sortOrder: 2,
          toState: {
            code: "Liquidada",
            id: "state-6",
            name: "Liquidada",
            owner: { code: "RIESGO", id: "owner-2", name: "Riesgo" },
          },
        },
      ],
      listHistory: async () => [],
    };
    const useCase = new ListSolicitudTransitionsUseCase({
      repository,
      sociosRepository: socioRepository({ lookupByDocumento: async () => [] }),
      solicitudesRepository: solicitudesRepository(),
    });

    const transitions = await useCase.execute({
      solicitudId: "sol-1",
      workflowOwnerId: "owner-1",
    });

    assert.deepEqual(
      transitions.map((transition) => ({
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
    findById: async () => ({
      conyuge: null,
      createdAt: new Date(),
      createdBy: "user-1",
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
      fechaPrimerVencimiento: null,
      montoAFinanciar: null,
      motivo: null,
      nroOperacion: null,
      nroSolicitud: null,
      observaciones: null,
      titular: {
        apellidoDenominacion: "Perez",
        cbu: null,
        celular: null,
        cuit: "20-33344455-9",
        domicilioCalle: null,
        email: null,
        estadoCivil: null,
        localidad: null,
        nacionalidad: null,
        nombre: "Juan",
        nroDocumento: "33.344.455",
        nroPuerta: null,
        nroSocio: null,
        personaExpuestaPoliticamente: null,
        sexo: null,
        telefonoFijo: null,
        tipoDocumento: "DNI",
      },
      updatedAt: new Date(),
      vendedorSolicitud: null,
    }),
    listByOwner: async () => [],
    update: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}
