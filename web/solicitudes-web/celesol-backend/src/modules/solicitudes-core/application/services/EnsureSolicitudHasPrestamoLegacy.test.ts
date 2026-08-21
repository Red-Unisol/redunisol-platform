import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import {
  SolicitudCoreNotFoundError,
  SolicitudPrestamoLegacyRequiredForWorkflowError,
} from "../../domain/solicitudes-core-errors";
import { EnsureSolicitudHasPrestamoLegacy } from "./EnsureSolicitudHasPrestamoLegacy";

describe("EnsureSolicitudHasPrestamoLegacy", () => {
  describe("check", () => {
    it("returns true when legacyOid is set", async () => {
      const service = new EnsureSolicitudHasPrestamoLegacy({
        solicitudesRepository: solicitudesRepository({
          findById: async () => solicitud({ legacyOid: "555000" }),
        }),
      });

      assert.equal(await service.check("sol-1"), true);
    });

    it("returns false when legacyOid is null", async () => {
      const service = new EnsureSolicitudHasPrestamoLegacy({
        solicitudesRepository: solicitudesRepository(),
      });

      assert.equal(await service.check("sol-1"), false);
    });

    it("throws SolicitudCoreNotFoundError when the solicitud does not exist", async () => {
      const service = new EnsureSolicitudHasPrestamoLegacy({
        solicitudesRepository: solicitudesRepository({
          findById: async () => null,
        }),
      });

      await assert.rejects(() => service.check("missing"), SolicitudCoreNotFoundError);
    });
  });

  describe("execute", () => {
    it("resolves when legacyOid is set", async () => {
      const service = new EnsureSolicitudHasPrestamoLegacy({
        solicitudesRepository: solicitudesRepository({
          findById: async () => solicitud({ legacyOid: "555000" }),
        }),
      });

      await assert.doesNotReject(() => service.execute("sol-1"));
    });

    it("throws SolicitudPrestamoLegacyRequiredForWorkflowError when legacyOid is null", async () => {
      const service = new EnsureSolicitudHasPrestamoLegacy({
        solicitudesRepository: solicitudesRepository(),
      });

      await assert.rejects(
        () => service.execute("sol-1"),
        SolicitudPrestamoLegacyRequiredForWorkflowError,
      );
    });
  });
});

function solicitud(overrides: Partial<SolicitudCore> = {}): SolicitudCore {
  return {
    id: "sol-1",
    createdAt: new Date("2026-05-18T10:00:00.000Z"),
    createdBy: "user-1",
    cuotaResultante: null,
    cuotas: null,
    ejecutivoSolicitud: null,
    estadoActual: {
      code: "Confirmada",
      id: "state-4",
      name: "Confirmada",
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
      celular: null,
      cuit: "20-33344455-9",
      domicilioCalle: null,
      email: null,
      localidad: null,
      nombre: "Juan",
      nroDocumento: "33.344.455",
      nroPuerta: null,
      nroSocio: null,
      sexo: null,
      tipoDocumento: "DNI",
    },
    updatedAt: new Date("2026-05-18T10:00:00.000Z"),
    vendedorSolicitud: null,
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
