import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import {
  SolicitudCoreNotFoundError,
  SolicitudTitularSocioRequiredForWorkflowError,
} from "../../domain/solicitudes-core-errors";
import { EnsureSolicitudTitularSocioExists } from "./EnsureSolicitudTitularSocioExists";

describe("EnsureSolicitudTitularSocioExists", () => {
  describe("check", () => {
    it("returns true when a socio matches the titular documento", async () => {
      const service = new EnsureSolicitudTitularSocioExists({
        sociosRepository: socioRepository(),
        solicitudesRepository: solicitudesRepository(),
      });

      const result = await service.check("sol-1");

      assert.equal(result, true);
    });

    it("returns false when no socio matches the titular documento or cuit", async () => {
      const service = new EnsureSolicitudTitularSocioExists({
        sociosRepository: socioRepository({ lookupByDocumento: async () => [] }),
        solicitudesRepository: solicitudesRepository(),
      });

      const result = await service.check("sol-1");

      assert.equal(result, false);
    });

    it("throws SolicitudCoreNotFoundError when the solicitud does not exist", async () => {
      const service = new EnsureSolicitudTitularSocioExists({
        sociosRepository: socioRepository(),
        solicitudesRepository: solicitudesRepository({ findById: async () => null }),
      });

      await assert.rejects(() => service.check("missing"), SolicitudCoreNotFoundError);
    });
  });

  describe("execute", () => {
    it("resolves when a socio matches the titular", async () => {
      const service = new EnsureSolicitudTitularSocioExists({
        sociosRepository: socioRepository(),
        solicitudesRepository: solicitudesRepository(),
      });

      await assert.doesNotReject(() => service.execute("sol-1"));
    });

    it("throws SolicitudTitularSocioRequiredForWorkflowError when no socio matches", async () => {
      const service = new EnsureSolicitudTitularSocioExists({
        sociosRepository: socioRepository({ lookupByDocumento: async () => [] }),
        solicitudesRepository: solicitudesRepository(),
      });

      await assert.rejects(
        () => service.execute("sol-1"),
        SolicitudTitularSocioRequiredForWorkflowError,
      );
    });
  });
});

function socioRepository(overrides: Partial<SocioRepository> = {}): SocioRepository {
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
        celular: null,
        cuit: "20-33344455-9",
        domicilioCalle: null,
        email: null,
        localidad: null,
        nombre: "Juan",
        nroDocumento: "33.344.455",
        nroPuerta: null,
        nroSocio: null,
        tipoDocumento: "DNI",
      },
      updatedAt: new Date("2026-05-18T10:00:00.000Z"),
      vendedorSolicitud: null,
    }),
    listByOwner: async () => [],
    update: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}
