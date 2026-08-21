import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SolicitudCoreNotFoundError,
  SolicitudPrestamoNoGeneradoError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { SolicitudesLegacyGateway } from "../../../solicitudes/domain/services/SolicitudesLegacyGateway";
import type { PrestamoOtorgadoLegacy } from "../../../solicitudes/domain/entities/Solicitud.entity";
import { GetFinSolicitudDatosUseCase } from "./GetFinSolicitudDatos.use-case";

function buildSolicitud(
  overrides: Partial<SolicitudCore> = {},
): SolicitudCore {
  return {
    createdAt: new Date("2026-05-12T10:00:00.000Z"),
    createdBy: "user-1",
    cuotaResultante: "62.867,51",
    cuotas: 24,
    ejecutivoSolicitud: null,
    estadoActual: {
      code: "Confirmada",
      id: "state-1",
      name: "Confirmada",
      ownerId: "owner-1",
    },
    firmaDigitalmente: false,
    id: "sol-1",
    garantias: [],
    legacyOid: "228418",
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
    montoAFinanciar: 489100,
    motivo: null,
    nroSolicitud: null,
    observaciones: null,
    titular: {
      apellidoDenominacion: "SCHIERANO",
      cbu: null,
      celular: "3425912911",
      cuit: null,
      domicilioCalle: "LIBERTAD 2461",
      email: null,
      estadoCivil: null,
      fechaNacimiento: "1952-01-07",
      localidad: "LAGUNA PAIVA",
      nacionalidad: "ARGENTINA",
      nombre: "GRACIELA NOEMI",
      nroDocumento: "10058077",
      nroPuerta: "",
      nroSocio: null,
      personaExpuestaPoliticamente: null,
      sexo: null,
      telefonoFijo: "00000000000000",
      tipoDocumento: "DNI",
    },
    updatedAt: new Date("2026-05-12T10:00:00.000Z"),
    vendedorSolicitud: null,
    ...overrides,
  };
}

function buildPrestamo(
  overrides: Partial<PrestamoOtorgadoLegacy> = {},
): PrestamoOtorgadoLegacy {
  return {
    capital: 610230.51,
    cft: 2.011199596488547,
    fechaEmision: "2025-05-15",
    montoPrestamo: 1508820.22,
    nroCuenta: "1002560",
    primerVencimiento: "2025-05-31",
    tea: 1.8127,
    tem: 0.09,
    tna: 1.095,
    vencimiento: "2027-04-30",
    ...overrides,
  };
}

function buildRepository(
  solicitud: SolicitudCore | null,
): SolicitudesCoreRepository {
  return {
    create: async () => {
      throw new Error("not used");
    },
    findById: async () => solicitud,
    findByLegacyOid: async () => solicitud,
    listByOwner: async () => [],
    update: async () => {
      throw new Error("not used");
    },
  };
}

function buildLegacyGateway(
  prestamo: PrestamoOtorgadoLegacy | null,
): SolicitudesLegacyGateway {
  return {
    getDetalleByNroSolicitud: async () => [],
    getDetailByOid: async () => [],
    getHistoricas: async () => [],
    getLegacyUserId: async () => null,
    getLineasPrestamoByLegacyUser: async () => [],
    getPrecarga: async () => [],
    getPrestamoOtorgadoByLegacyOid: async () => prestamo,
    getRecientes: async () => [],
    getSocioByDni: async () => [],
    getSocioMutualCancelacionDetalleById: async () => null,
    getVendedorLegacyId: async () => null,
    listSociosCancelaciones: async () => [],
  };
}

describe("GetFinSolicitudDatosUseCase", () => {
  it("combina datos del core con el prestamo del legacy cuando sol es el legacyOid", async () => {
    const useCase = new GetFinSolicitudDatosUseCase({
      legacyGateway: buildLegacyGateway(buildPrestamo()),
      repository: buildRepository(buildSolicitud()),
    });

    const datos = await useCase.execute({ sol: "228418" });

    assert.equal(datos.nombreSocio, "SCHIERANO GRACIELA NOEMI");
    assert.equal(datos.cuotas, "24");
    assert.equal(datos.cuotaResultante, "62867,5100");
    assert.equal(datos.montoAfinanciar, "$ 489.100,00");
    assert.equal(datos.NumeroPrestamo, 1002560);
    assert.equal(datos.CapitalOriginal, "$ 610.230,51");
    assert.equal(datos.MontoPrestamo, "$ 1.508.820,22");
    assert.equal(datos.PrimerVencimiento, "2025-05-31T00:00:00");
    assert.equal(datos.Vencimiento, "2027-04-30T00:00:00");
    assert.equal(datos.FechaEmision, "2025-05-15T00:00:00");
    assert.equal(datos.DNI, 10058077);
    assert.equal(datos.FechaNacimiento, "1952-01-07T00:00:00");
    assert.equal(datos.Nacionalidad, "ARGENTINA");
    assert.equal(datos.TelefonoMovil, "3425912911");
    assert.equal(datos.Localidad, "LAGUNA PAIVA");
    assert.equal(datos.CodigoPostal, null);
    assert.equal(datos.Calle, "LIBERTAD 2461");
    assert.equal(datos.prestamoTEM, "0,0900");
    assert.equal(datos.prestamoTNA, "1,0950");
    assert.equal(datos.prestamoTEA, "1,8127");
    assert.equal(typeof datos.prestamoCFT, "string");
    assert.match(datos.prestamoCFT ?? "", /^2,011199596/);
  });

  it("combina datos del core con el prestamo del legacy cuando sol es nuestro uuid", async () => {
    const useCase = new GetFinSolicitudDatosUseCase({
      legacyGateway: buildLegacyGateway(buildPrestamo()),
      repository: buildRepository(buildSolicitud()),
    });

    const datos = await useCase.execute({
      sol: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    });

    assert.equal(datos.nombreSocio, "SCHIERANO GRACIELA NOEMI");
  });

  it("lanza SolicitudCoreNotFoundError si la solicitud no existe (legacyOid)", async () => {
    const useCase = new GetFinSolicitudDatosUseCase({
      legacyGateway: buildLegacyGateway(null),
      repository: buildRepository(null),
    });

    await assert.rejects(
      () => useCase.execute({ sol: "no-existe" }),
      SolicitudCoreNotFoundError,
    );
  });

  it("lanza SolicitudCoreNotFoundError si la solicitud no existe (uuid)", async () => {
    const useCase = new GetFinSolicitudDatosUseCase({
      legacyGateway: buildLegacyGateway(null),
      repository: buildRepository(null),
    });

    await assert.rejects(
      () => useCase.execute({ sol: "3fa85f64-5717-4562-b3fc-2c963f66afa6" }),
      SolicitudCoreNotFoundError,
    );
  });

  it("lanza SolicitudPrestamoNoGeneradoError si legacyOid es null", async () => {
    const useCase = new GetFinSolicitudDatosUseCase({
      legacyGateway: buildLegacyGateway(null),
      repository: buildRepository(buildSolicitud({ legacyOid: null })),
    });

    await assert.rejects(
      () => useCase.execute({ sol: "228418" }),
      SolicitudPrestamoNoGeneradoError,
    );
  });

  it("lanza SolicitudPrestamoNoGeneradoError si el legacy no encuentra el prestamo", async () => {
    const useCase = new GetFinSolicitudDatosUseCase({
      legacyGateway: buildLegacyGateway(null),
      repository: buildRepository(buildSolicitud()),
    });

    await assert.rejects(
      () => useCase.execute({ sol: "228418" }),
      SolicitudPrestamoNoGeneradoError,
    );
  });
});
