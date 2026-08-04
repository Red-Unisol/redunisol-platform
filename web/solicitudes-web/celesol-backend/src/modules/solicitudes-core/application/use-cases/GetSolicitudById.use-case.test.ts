import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SolicitudCoreNotFoundError } from "../../domain/solicitudes-core-errors";
import type { SolicitudFieldAccessRulesRepository } from "../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import {
  EDITABLE_FIELDS,
  EDITABLE_GROUPS,
  LEGACY_EDITABLE_GROUPS,
} from "../services/SolicitudFieldAccess";
import { GetSolicitudByIdUseCase } from "./GetSolicitudById.use-case";

describe("GetSolicitudByIdUseCase", () => {
  it("returns the solicitud when it belongs to the authenticated creator", async () => {
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => ({
        createdAt: new Date("2026-05-12T10:00:00.000Z"),
        createdBy: "user-1",
        cuotaResultante: "10000",
        cuotas: 12,
        ejecutivoSolicitud: "Ejecutivo Uno",
        estadoActual: {
          code: "CargaVendedor",
          id: "state-1",
          name: "Carga vendedor",
          ownerId: "owner-1",
        },
        firmaDigitalmente: false,
        id: "sol-1",
        garantias: [
          {
            antiguedadLaboralMeses: 12,
            casadoConTitular: false,
            celular: "1199999999",
            cuit: "20300111222",
            denominacion: "Gar1",
            domicilio: "Calle 1",
            edad: 35,
            email: "gar1@example.com",
            estadoCivil: "Soltero",
            fechaIngresoLaboral: "2023-01-10",
            fechaNacimiento: "1989-03-02",
            ingresoMensual: 120000,
            nacionalidad: "Argentina",
            nombre: "Carlos",
            nombreCompleto: "Carlos Gomez",
            nroDocumento: "30011122",
            nroSocio: "GS-1",
            ocupacion: "Chofer",
            observaciones: "Garantia 1",
            persona: "Fisica",
            sexo: "M",
            sumaIngresos: true,
            telefono: "1144444444",
            tipoDocumento: "DNI",
            tipoGarantia: "Codeudor",
            tipoRelacion: "Amigo",
          },
        ],
        legacyOid: null,
        lineaPrestamoDescripcion: "Personal",
        lineaPrestamoLegacyOid: "LP-1",
        cupoTitular: 150000,
        fechaPrimerVencimiento: "2026-06-01",
        nroOperacion: "OP-123",
        conyuge: null,
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
        montoAFinanciar: 100000,
        motivo: "Compra",
        nroSolicitud: null,
        observaciones: null,
        titular: {
          apellidoDenominacion: "Perez",
          cbu: null,
          celular: null,
          cuit: null,
          domicilioCalle: null,
          email: null,
          estadoCivil: "Soltero",
          localidad: null,
          nacionalidad: "Argentina",
          nombre: "Juan",
          nroDocumento: "33344455",
          nroPuerta: null,
          nroSocio: null,
          personaExpuestaPoliticamente: true,
          sexo: "M",
          telefonoFijo: "1144444444",
          tipoDocumento: "DNI",
        },
        updatedAt: new Date("2026-05-12T10:00:00.000Z"),
        vendedorSolicitud: "Vendedor Uno",
      }),
      listByOwner: async () => [],
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new GetSolicitudByIdUseCase({
      fieldAccessRulesRepository: buildFieldAccessRulesRepository(),
      repository,
    });

    const solicitud = await useCase.execute({
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      id: "sol-1",
    });

    assert.equal(solicitud.id, "sol-1");
    assert.equal(solicitud.fechaPrimerVencimiento, "2026-06-01");
    assert.equal(solicitud.nroOperacion, "OP-123");
    assert.equal(solicitud.cupoTitular, 150000);
    assert.equal(solicitud.titular.personaExpuestaPoliticamente, true);
    assert.equal(solicitud.titular.estadoCivil, "Soltero");
    assert.equal(solicitud.titular.nacionalidad, "Argentina");
    assert.equal(solicitud.titular.sexo, "M");
    assert.equal(solicitud.titular.telefonoFijo, "1144444444");
    assert.deepEqual(solicitud.appearance, {
      backgroundColor: "#FF7F7F",
      textColor: "#000000",
    });
    assert.equal(solicitud.capabilities?.fieldAccess?.defaultMode, "readonly");
    assert.deepEqual(solicitud.capabilities?.fieldAccess?.editableGroups, [
      "garantias",
    ]);
  });

  it("allows the creator to view detail after the solicitud moved to another workflow owner", async () => {
    const repository = repositoryReturning({
      createdBy: "user-1",
      estadoActual: {
        code: "Analisis",
        id: "state-2",
        name: "Analisis",
        ownerId: "owner-2",
      },
      participants: [],
    });
    const useCase = new GetSolicitudByIdUseCase({
      fieldAccessRulesRepository: buildFieldAccessRulesRepository(),
      repository,
    });

    const solicitud = await useCase.execute({
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      id: "sol-1",
    });

    assert.equal(solicitud.id, "sol-1");
  });

  it("allows a participant to view detail after the solicitud moved to another workflow owner", async () => {
    const repository = repositoryReturning({
      createdBy: "creator-1",
      estadoActual: {
        code: "Analisis",
        id: "state-2",
        name: "Analisis",
        ownerId: "owner-2",
      },
      participants: [{ userId: "participant-1" }],
    });
    const useCase = new GetSolicitudByIdUseCase({
      fieldAccessRulesRepository: buildFieldAccessRulesRepository(),
      repository,
    });

    const solicitud = await useCase.execute({
      currentUser: {
        id: "participant-1",
        workflowOwnerId: "owner-1",
      },
      id: "sol-1",
    });

    assert.equal(solicitud.id, "sol-1");
  });

  it("allows an authenticated non-owner to view detail without creator or participant relation", async () => {
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => ({
        createdAt: new Date("2026-05-12T10:00:00.000Z"),
        createdBy: "user-2",
        cuotaResultante: null,
        cuotas: 12,
        ejecutivoSolicitud: null,
        estadoActual: {
          code: "CargaVendedor",
          id: "state-1",
          name: "Carga vendedor",
          ownerId: "owner-2",
        },
        firmaDigitalmente: false,
        id: "sol-1",
        garantias: [],
        legacyOid: null,
        lineaPrestamoDescripcion: "Personal",
        lineaPrestamoLegacyOid: "LP-1",
        cupoTitular: null,
        fechaPrimerVencimiento: null,
        nroOperacion: null,
        conyuge: null,
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
        montoAFinanciar: 100000,
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
          estadoCivil: null,
          localidad: null,
          nacionalidad: null,
          nombre: "Juan",
          nroDocumento: "33344455",
          nroPuerta: null,
          nroSocio: null,
          personaExpuestaPoliticamente: null,
          sexo: null,
          telefonoFijo: null,
          tipoDocumento: "DNI",
        },
        updatedAt: new Date("2026-05-12T10:00:00.000Z"),
        vendedorSolicitud: null,
      }),
      listByOwner: async () => [],
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new GetSolicitudByIdUseCase({
      fieldAccessRulesRepository: buildFieldAccessRulesRepository(),
      repository,
    });

    const solicitud = await useCase.execute({
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      id: "sol-1",
    });

    assert.equal(solicitud.id, "sol-1");
    assert.equal(solicitud.capabilities?.canView, true);
    assert.equal(solicitud.capabilities?.canEdit, false);
    assert.equal(solicitud.capabilities?.fieldAccess?.defaultMode, "readonly");
    assert.deepEqual(solicitud.capabilities?.fieldAccess?.editableFields, [
      ...EDITABLE_FIELDS,
    ]);
  });

  it("returns readonly fieldAccess for readonly workflow states", async () => {
    const useCase = new GetSolicitudByIdUseCase({
      fieldAccessRulesRepository: buildFieldAccessRulesRepository({
        findByWorkflowStateId: async () => null,
      }),
      repository: repositoryReturning({
        estadoActual: {
          code: "Confirmada",
          id: "state-2",
          name: "Confirmada",
          ownerId: "owner-2",
        },
      }),
    });

    const solicitud = await useCase.execute({
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      id: "sol-1",
    });

    assert.deepEqual(solicitud.capabilities?.fieldAccess, {
      defaultMode: "readonly",
      editableFields: [],
      editableGroups: [],
      readonlyReason: "La solicitud no admite edicion de datos en su estado actual.",
    });
  });

  it("returns readonly fieldAccess when an editable state has no persisted rule", async () => {
    const useCase = new GetSolicitudByIdUseCase({
      fieldAccessRulesRepository: buildFieldAccessRulesRepository({
        findByWorkflowStateId: async () => null,
      }),
      repository: repositoryReturning({
        estadoActual: {
          code: "CargaVendedor",
          id: "state-1",
          name: "Carga vendedor",
          ownerId: "owner-1",
        },
      }),
    });

    const solicitud = await useCase.execute({
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      id: "sol-1",
    });

    assert.deepEqual(solicitud.capabilities?.fieldAccess, {
      defaultMode: "readonly",
      editableFields: [],
      editableGroups: [],
      readonlyReason: "La solicitud no admite edicion de datos en su estado actual.",
    });
  });

  it("returns full editable field access and non-readonly appearance for a system admin regardless of workflow state or persisted rule", async () => {
    const useCase = new GetSolicitudByIdUseCase({
      fieldAccessRulesRepository: buildFieldAccessRulesRepository({
        findByWorkflowStateId: async () => null,
      }),
      repository: repositoryReturning({
        estadoActual: {
          code: "Confirmada",
          id: "state-2",
          name: "Confirmada",
          ownerId: "owner-2",
        },
      }),
    });

    const solicitud = await useCase.execute({
      currentUser: {
        id: "admin-1",
        isSystemAdmin: true,
        workflowOwnerId: null,
      },
      id: "sol-1",
    });

    assert.deepEqual(solicitud.capabilities?.fieldAccess, {
      defaultMode: "readonly",
      editableFields: [...EDITABLE_FIELDS],
      editableGroups: [...EDITABLE_GROUPS, ...LEGACY_EDITABLE_GROUPS],
    });
    assert.deepEqual(solicitud.appearance, {
      backgroundColor: null,
      textColor: null,
    });
  });

  it("does not use createdBy as fallback when owner matches", async () => {
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => ({
        createdAt: new Date("2026-05-12T10:00:00.000Z"),
        createdBy: "different-user",
        cuotaResultante: null,
        cuotas: 12,
        ejecutivoSolicitud: null,
        estadoActual: {
          code: "CargaVendedor",
          id: "state-1",
          name: "Carga vendedor",
          ownerId: "owner-1",
        },
        firmaDigitalmente: false,
        id: "sol-1",
        garantias: [],
        legacyOid: null,
        lineaPrestamoDescripcion: "Personal",
        lineaPrestamoLegacyOid: "LP-1",
        cupoTitular: null,
        fechaPrimerVencimiento: null,
        nroOperacion: null,
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
        titular: {
          apellidoDenominacion: null,
          cbu: null,
          celular: null,
          cuit: null,
          domicilioCalle: null,
          email: null,
          estadoCivil: null,
          localidad: null,
          nacionalidad: null,
          nombre: null,
          nroDocumento: null,
          nroPuerta: null,
          nroSocio: null,
          personaExpuestaPoliticamente: null,
          sexo: null,
          telefonoFijo: null,
          tipoDocumento: null,
        },
        updatedAt: new Date("2026-05-12T10:00:00.000Z"),
        vendedorSolicitud: null,
      }),
      listByOwner: async () => [],
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new GetSolicitudByIdUseCase({
      fieldAccessRulesRepository: buildFieldAccessRulesRepository(),
      repository,
    });

    const solicitud = await useCase.execute({
      currentUser: {
        id: "operator-1",
        workflowOwnerId: "owner-1",
      },
      id: "sol-1",
    });

    assert.equal(solicitud.id, "sol-1");
    assert.equal(solicitud.createdBy, "different-user");
  });

  it("rejects when the solicitud does not exist", async () => {
    const repository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listByOwner: async () => [],
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new GetSolicitudByIdUseCase({
      fieldAccessRulesRepository: buildFieldAccessRulesRepository(),
      repository,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: {
            id: "user-1",
            workflowOwnerId: "owner-1",
          },
          id: "missing",
        }),
      SolicitudCoreNotFoundError,
    );
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
        if (workflowStateId === "state-1") {
          return {
            active: true,
            backgroundColor: "#FF7F7F",
            canManageAttachments: true,
            defaultMode: "readonly",
            editableFields: [...EDITABLE_FIELDS],
            editableGroups: ["garantias"],
            readonlyReason: null,
            textColor: "#000000",
            workflowStateId,
          };
        }

        return null;
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

function repositoryReturning(
  solicitud: Partial<Awaited<ReturnType<SolicitudesCoreRepository["findById"]>>>,
): SolicitudesCoreRepository {
  return {
    create: async () => {
      throw new Error("not used");
    },
    findById: async () => ({
      createdAt: new Date("2026-05-12T10:00:00.000Z"),
      createdBy: "user-1",
      cuotaResultante: null,
      cuotas: null,
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
      titular: {
        apellidoDenominacion: null,
        cbu: null,
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
      ...solicitud,
    }),
    listByOwner: async () => [],
    update: async () => {
      throw new Error("not used");
    },
  };
}
