import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import {
  SolicitudCoreNotFoundError,
  SolicitudTitularDataIncompleteForConfirmarError,
} from "../../domain/solicitudes-core-errors";
import { EnsureSolicitudTitularHasRequiredDataForConfirmar } from "./EnsureSolicitudTitularHasRequiredDataForConfirmar";

describe("EnsureSolicitudTitularHasRequiredDataForConfirmar", () => {
  describe("check", () => {
    it("returns isComplete true when all required titular fields are present", async () => {
      const service = new EnsureSolicitudTitularHasRequiredDataForConfirmar({
        solicitudesRepository: solicitudesRepository(),
      });

      const result = await service.check("sol-1");

      assert.deepEqual(result, { isComplete: true, missingLabels: [] });
    });

    it("lists the labels of missing required fields", async () => {
      const service = new EnsureSolicitudTitularHasRequiredDataForConfirmar({
        solicitudesRepository: solicitudesRepository({
          findById: async () => solicitud({ sexo: null, cuit: "", email: null }),
        }),
      });

      const result = await service.check("sol-1");

      assert.deepEqual(result, {
        isComplete: false,
        missingLabels: ["Sexo", "CUIT", "Email"],
      });
    });

    it("throws SolicitudCoreNotFoundError when the solicitud does not exist", async () => {
      const service = new EnsureSolicitudTitularHasRequiredDataForConfirmar({
        solicitudesRepository: solicitudesRepository({
          findById: async () => null,
        }),
      });

      await assert.rejects(
        () => service.check("missing"),
        SolicitudCoreNotFoundError,
      );
    });
  });

  describe("execute", () => {
    it("resolves when all required titular fields are present", async () => {
      const service = new EnsureSolicitudTitularHasRequiredDataForConfirmar({
        solicitudesRepository: solicitudesRepository(),
      });

      await assert.doesNotReject(() => service.execute("sol-1"));
    });

    it("throws SolicitudTitularDataIncompleteForConfirmarError with the missing labels", async () => {
      const service = new EnsureSolicitudTitularHasRequiredDataForConfirmar({
        solicitudesRepository: solicitudesRepository({
          findById: async () => solicitud({ fechaNacimiento: null }),
        }),
      });

      await assert.rejects(
        () => service.execute("sol-1"),
        (error: unknown) => {
          assert.ok(error instanceof SolicitudTitularDataIncompleteForConfirmarError);
          assert.deepEqual(error.missingLabels, ["Fecha de nacimiento"]);
          assert.equal(
            error.message,
            "Debe completar los siguientes datos del titular antes de confirmar: Fecha de nacimiento.",
          );
          return true;
        },
      );
    });
  });
});

function solicitud(
  titularOverrides: Partial<SolicitudCore["titular"]> = {},
): SolicitudCore {
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
      ...titularOverrides,
    },
    updatedAt: new Date("2026-05-18T10:00:00.000Z"),
    vendedorSolicitud: null,
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
