import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CreateSolicitudInput } from "../dtos/CreateSolicitud.dto";
import { CreateSolicitudUseCase } from "./CreateSolicitud.use-case";
import {
  LegacyLineaPrestamoUnavailableError,
  MissingAuthenticatedLegacyUserError,
  MissingAuthenticatedSellerNameError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { WorkflowStateCatalog } from "../../domain/services/WorkflowStateCatalog";
import type { LineasPrestamoCatalog } from "../../domain/services/LineasPrestamoCatalog";

const createInput = (): CreateSolicitudInput => ({
  createdBy: "user-1",
  authenticatedSellerName: "elias gallay",
  createdByLegacyUser: "EGALLAY",
  cuotaResultante: "10000",
  cuotas: 12,
  ejecutivoSolicitud: "Ejecutivo Uno",
  firmaDigitalmente: true,
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
    {
      antiguedadLaboralMeses: 60,
      casadoConTitular: true,
      celular: "1188888888",
      cuit: "27222333444",
      denominacion: "Gar2",
      domicilio: "Calle 2",
      edad: 40,
      email: "gar2@example.com",
      estadoCivil: "Casado",
      fechaIngresoLaboral: "2019-06-15",
      fechaNacimiento: "1984-07-09",
      ingresoMensual: 180000,
      nacionalidad: "Argentina",
      nombre: "Maria",
      nombreCompleto: "Maria Lopez",
      nroDocumento: "32223334",
      nroSocio: "GS-2",
      ocupacion: "Docente",
      observaciones: "Garantia 2",
      persona: "Fisica",
      sexo: "F",
      sumaIngresos: false,
      telefono: "1133333333",
      tipoDocumento: "DNI",
      tipoGarantia: "Garante",
      tipoRelacion: "Hermana",
    },
  ],
  conyuge: {
    actividad: "Docente",
    apellido: "Gomez",
    fechaNacimiento: "1988-07-09",
    ingresosMensuales: 180000,
    nacionalidad: "Argentina",
    nombre: "Maria",
    nroDocumento: "32223334",
    sexo: "F",
    tipoDocumento: "DNI",
  },
  lineaPrestamoLegacyOid: "LP-1",
  cupoTitular: 150000,
  fechaPrimerVencimiento: "2026-06-01",
  montoAFinanciar: 120000,
  motivo: "Compra",
  nroOperacion: "OP-123",
  observaciones: "Observaciones",
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
    personaExpuestaPoliticamente: true,
    sexo: "M",
    telefonoFijo: "1144444444",
    tipoDocumento: "DNI",
  },
  vendedorSolicitud: "VENDEDOR_FALSO",
});

describe("CreateSolicitudUseCase", () => {
  it("creates a persisted solicitud with initial state and linea snapshot", async () => {
    const repository = new InMemorySolicitudesCoreRepository();
    const workflowStateCatalog: WorkflowStateCatalog = {
      getInitialState: async () => ({
        code: "CargaVendedor",
        id: "state-1",
        name: "Carga vendedor",
      }),
    };
    const lineasPrestamoCatalog: LineasPrestamoCatalog = {
      findByLegacyUserAndOid: async () => ({
        descripcion: "Personal",
        legacyOid: "LP-1",
        vigente: true,
      }),
    };
    const useCase = new CreateSolicitudUseCase({
      simularCuotaSolicitud: { execute: async () => null },
      lineasPrestamoCatalog,
      repository,
      workflowStateCatalog,
    });

    const created = await useCase.execute(createInput());

    assert.equal(created.createdBy, "user-1");
    assert.equal(created.vendedorSolicitud, "Elias Gallay");
    assert.equal(created.estadoActual.id, "state-1");
    assert.equal(created.estadoActual.code, "CargaVendedor");
    assert.equal(created.lineaPrestamoLegacyOid, "LP-1");
    assert.equal(created.lineaPrestamoDescripcion, "Personal");
    assert.equal(created.fechaPrimerVencimiento, "2026-06-01");
    assert.equal(created.nroOperacion, "OP-123");
    assert.equal(created.cupoTitular, 150000);
    assert.equal(created.titular.personaExpuestaPoliticamente, true);
    assert.equal(created.titular.estadoCivil, "Soltero");
    assert.equal(created.titular.nacionalidad, "Argentina");
    assert.equal(created.titular.sexo, "M");
    assert.equal(created.titular.telefonoFijo, "1144444444");
    assert.equal(created.conyuge?.nombre, "Maria");
    assert.equal(created.legacyOid, null);
  });

  it("ignores vendedorSolicitud provided by the client and persists the authenticated seller name", async () => {
    const repository = new InMemorySolicitudesCoreRepository();
    const workflowStateCatalog: WorkflowStateCatalog = {
      getInitialState: async () => ({
        code: "CargaVendedor",
        id: "state-1",
        name: "Carga vendedor",
      }),
    };
    const lineasPrestamoCatalog: LineasPrestamoCatalog = {
      findByLegacyUserAndOid: async () => ({
        descripcion: "Personal",
        legacyOid: "LP-1",
        vigente: true,
      }),
    };
    const useCase = new CreateSolicitudUseCase({
      simularCuotaSolicitud: { execute: async () => null },
      lineasPrestamoCatalog,
      repository,
      workflowStateCatalog,
    });

    const created = await useCase.execute({
      ...createInput(),
      vendedorSolicitud: "VENDEDOR_FALSO",
    });

    assert.equal(created.createdBy, "user-1");
    assert.equal(created.vendedorSolicitud, "Elias Gallay");
  });

  it("formats authenticated seller name with title case before persisting vendedorSolicitud", async () => {
    const repository = new InMemorySolicitudesCoreRepository();
    const workflowStateCatalog: WorkflowStateCatalog = {
      getInitialState: async () => ({
        code: "CargaVendedor",
        id: "state-1",
        name: "Carga vendedor",
      }),
    };
    const lineasPrestamoCatalog: LineasPrestamoCatalog = {
      findByLegacyUserAndOid: async () => ({
        descripcion: "Personal",
        legacyOid: "LP-1",
        vigente: true,
      }),
    };
    const useCase = new CreateSolicitudUseCase({
      simularCuotaSolicitud: { execute: async () => null },
      lineasPrestamoCatalog,
      repository,
      workflowStateCatalog,
    });

    const created = await useCase.execute({
      ...createInput(),
      authenticatedSellerName: "ELIAS GALLAY",
    });

    assert.equal(created.vendedorSolicitud, "Elias Gallay");
  });

  it("rejects creation when the linea prestamo cannot be validated in legacy", async () => {
    const repository = new InMemorySolicitudesCoreRepository();
    const workflowStateCatalog: WorkflowStateCatalog = {
      getInitialState: async () => ({
        code: "CargaVendedor",
        id: "state-1",
        name: "Carga vendedor",
      }),
    };
    const lineasPrestamoCatalog: LineasPrestamoCatalog = {
      findByLegacyUserAndOid: async () => null,
    };
    const useCase = new CreateSolicitudUseCase({
      simularCuotaSolicitud: { execute: async () => null },
      lineasPrestamoCatalog,
      repository,
      workflowStateCatalog,
    });

    await assert.rejects(
      () => useCase.execute(createInput()),
      LegacyLineaPrestamoUnavailableError,
    );
  });

  it("fails with a controlled error when the authenticated seller name is missing", async () => {
    const repository = new InMemorySolicitudesCoreRepository();
    const workflowStateCatalog: WorkflowStateCatalog = {
      getInitialState: async () => ({
        code: "CargaVendedor",
        id: "state-1",
        name: "Carga vendedor",
      }),
    };
    const lineasPrestamoCatalog: LineasPrestamoCatalog = {
      findByLegacyUserAndOid: async () => ({
        descripcion: "Personal",
        legacyOid: "LP-1",
        vigente: true,
      }),
    };
    const useCase = new CreateSolicitudUseCase({
      simularCuotaSolicitud: { execute: async () => null },
      lineasPrestamoCatalog,
      repository,
      workflowStateCatalog,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          ...createInput(),
          authenticatedSellerName: "   ",
        }),
      MissingAuthenticatedSellerNameError,
    );
  });

  it("fails with a controlled error when the authenticated legacy user is missing", async () => {
    const repository = new InMemorySolicitudesCoreRepository();
    const workflowStateCatalog: WorkflowStateCatalog = {
      getInitialState: async () => ({
        code: "CargaVendedor",
        id: "state-1",
        name: "Carga vendedor",
      }),
    };
    const lineasPrestamoCatalog: LineasPrestamoCatalog = {
      findByLegacyUserAndOid: async () => ({
        descripcion: "Personal",
        legacyOid: "LP-1",
        vigente: true,
      }),
    };
    const useCase = new CreateSolicitudUseCase({
      simularCuotaSolicitud: { execute: async () => null },
      lineasPrestamoCatalog,
      repository,
      workflowStateCatalog,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          ...createInput(),
          createdByLegacyUser: "   ",
        }),
      MissingAuthenticatedLegacyUserError,
    );
  });
});

class InMemorySolicitudesCoreRepository implements SolicitudesCoreRepository {
  async create(input: Parameters<SolicitudesCoreRepository["create"]>[0]) {
    return {
      id: "sol-1",
      createdAt: new Date("2026-05-12T10:00:00.000Z"),
      createdBy: input.createdBy,
      cuotaResultante: input.cuotaResultante,
      cuotas: input.cuotas,
      cupoTitular: input.cupoTitular ?? null,
      ejecutivoSolicitud: input.ejecutivoSolicitud,
      estadoActual: input.estadoActual,
      firmaDigitalmente: input.firmaDigitalmente,
      legacyOid: null,
      lineaPrestamoDescripcion: input.lineaPrestamoDescripcion,
      lineaPrestamoLegacyOid: input.lineaPrestamoLegacyOid,
      fechaPrimerVencimiento: input.fechaPrimerVencimiento ?? null,
      montoAFinanciar: input.montoAFinanciar,
      motivo: input.motivo,
      nroOperacion: input.nroOperacion ?? null,
      nroSolicitud: null,
      observaciones: input.observaciones,
      garantias: input.garantias ?? [],
      conyuge: input.conyuge
        ? {
            ...input.conyuge,
          }
        : null,
      datosLaborales: {
        ...input.datosLaborales,
      },
      titular: {
        ...input.titular,
      },
      updatedAt: new Date("2026-05-12T10:00:00.000Z"),
      vendedorSolicitud: input.vendedorSolicitud,
    };
  }

  async findById() {
    return null;
  }

  async listByOwner() {
    return [];
  }

  async update() {
    return {
      id: "sol-1",
      createdAt: new Date("2026-05-12T10:00:00.000Z"),
      createdBy: "user-1",
      cuotaResultante: "10000",
      cuotas: 12,
      ejecutivoSolicitud: "Ejecutivo Uno",
      estadoActual: {
        code: "CargaVendedor",
        id: "state-1",
        name: "Carga vendedor",
      },
      firmaDigitalmente: false,
      legacyOid: null,
      lineaPrestamoDescripcion: "Personal",
      lineaPrestamoLegacyOid: "LP-1",
      montoAFinanciar: 120000,
      motivo: "Compra",
      nroSolicitud: null,
      observaciones: "Observaciones",
      garantias: [],
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
      titular: {
        apellidoDenominacion: "Perez",
        cbu: "2850590940090418135201",
        celular: "1122334455",
        cuit: "20333444559",
        domicilioCalle: "Siempre Viva",
        email: "juan@example.com",
        localidad: "CABA",
        nombre: "Juan",
        nroDocumento: "33344455",
        nroPuerta: "742",
        nroSocio: "SM-1",
        tipoDocumento: "DNI",
      },
      updatedAt: new Date("2026-05-12T10:00:00.000Z"),
      vendedorSolicitud: "Elias Gallay",
    };
  }
}
