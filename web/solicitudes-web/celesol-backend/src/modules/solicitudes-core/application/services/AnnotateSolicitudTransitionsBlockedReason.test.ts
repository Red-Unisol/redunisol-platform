import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";
import type { WorkflowTransition } from "../../domain/entities/WorkflowTransition.entity";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import { AnnotateSolicitudTransitionsBlockedReason } from "./AnnotateSolicitudTransitionsBlockedReason";

describe("AnnotateSolicitudTransitionsBlockedReason", () => {
  it("sets blockedReason on the liquidar transition when the titular has no socio", async () => {
    const service = new AnnotateSolicitudTransitionsBlockedReason({
      sociosRepository: socioRepository({ lookupByDocumento: async () => [] }),
      solicitudesRepository: solicitudesRepository(),
    });

    const result = await service.execute(
      [transition({ actionCode: "desestimar" }), transition({ actionCode: "liquidar" })],
      "sol-1",
    );

    assert.deepEqual(
      result.map((t) => ({ actionCode: t.actionCode, blockedReason: t.blockedReason })),
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

  it("leaves transitions unchanged when the titular has a socio", async () => {
    const service = new AnnotateSolicitudTransitionsBlockedReason({
      sociosRepository: socioRepository(),
      solicitudesRepository: solicitudesRepository({
        findById: async () =>
          solicitudWithTitularOverrides({}, { legacyOid: "555000" }),
      }),
    });

    const result = await service.execute(
      [transition({ actionCode: "desestimar" }), transition({ actionCode: "liquidar" })],
      "sol-1",
    );

    assert.deepEqual(
      result.map((t) => t.blockedReason),
      [null, null],
    );
  });

  it("sets blockedReason on liquidar to the prestamo message when the titular has a socio but no legacyOid", async () => {
    const service = new AnnotateSolicitudTransitionsBlockedReason({
      sociosRepository: socioRepository(),
      solicitudesRepository: solicitudesRepository(),
    });

    const result = await service.execute(
      [transition({ actionCode: "liquidar" })],
      "sol-1",
    );

    assert.deepEqual(
      result.map((t) => t.blockedReason),
      ["Debe generar el préstamo antes de liquidar la solicitud."],
    );
  });

  it("leaves liquidar unblocked when the titular has a socio and legacyOid is set", async () => {
    const service = new AnnotateSolicitudTransitionsBlockedReason({
      sociosRepository: socioRepository(),
      solicitudesRepository: solicitudesRepository({
        findById: async () =>
          solicitudWithTitularOverrides({}, { legacyOid: "555000" }),
      }),
    });

    const result = await service.execute(
      [transition({ actionCode: "liquidar" })],
      "sol-1",
    );

    assert.deepEqual(
      result.map((t) => t.blockedReason),
      [null],
    );
  });

  it("prioritizes the socio-missing message over the prestamo-missing message when both are missing", async () => {
    const service = new AnnotateSolicitudTransitionsBlockedReason({
      sociosRepository: socioRepository({ lookupByDocumento: async () => [] }),
      solicitudesRepository: solicitudesRepository(),
    });

    const result = await service.execute(
      [transition({ actionCode: "liquidar" })],
      "sol-1",
    );

    assert.deepEqual(
      result.map((t) => t.blockedReason),
      ["Debe existir un socio creado para iniciar el flujo de la solicitud."],
    );
  });

  it("leaves transitions unchanged when liquidar is not in the list", async () => {
    const service = new AnnotateSolicitudTransitionsBlockedReason({
      sociosRepository: socioRepository({ lookupByDocumento: async () => [] }),
      solicitudesRepository: solicitudesRepository(),
    });

    const result = await service.execute(
      [transition({ actionCode: "desestimar" })],
      "sol-1",
    );

    assert.deepEqual(
      result.map((t) => t.blockedReason),
      [null],
    );
  });

  it("sets blockedReason on the confirmar transition when the titular is missing required data", async () => {
    const service = new AnnotateSolicitudTransitionsBlockedReason({
      sociosRepository: socioRepository(),
      solicitudesRepository: solicitudesRepository(),
    });

    const result = await service.execute(
      [transition({ actionCode: "desestimar" }), transition({ actionCode: "confirmar" })],
      "sol-1",
    );

    assert.deepEqual(
      result.map((t) => ({ actionCode: t.actionCode, blockedReason: t.blockedReason })),
      [
        { actionCode: "desestimar", blockedReason: null },
        {
          actionCode: "confirmar",
          blockedReason:
            "Debe completar los siguientes datos del titular antes de confirmar: Fecha de nacimiento, Sexo, Email, Celular.",
        },
      ],
    );
  });

  it("leaves confirmar unblocked when the titular has all required data", async () => {
    const completeSolicitud = solicitudWithTitularOverrides({
      celular: "1199999999",
      email: "juan@example.com",
      fechaNacimiento: "1990-05-20",
      sexo: "M",
    });
    const service = new AnnotateSolicitudTransitionsBlockedReason({
      sociosRepository: socioRepository(),
      solicitudesRepository: solicitudesRepository({
        findById: async () => completeSolicitud,
      }),
    });

    const result = await service.execute(
      [transition({ actionCode: "confirmar" })],
      "sol-1",
    );

    assert.deepEqual(
      result.map((t) => t.blockedReason),
      [null],
    );
  });

  it("annotates liquidar and confirmar independently when both are blocked", async () => {
    const service = new AnnotateSolicitudTransitionsBlockedReason({
      sociosRepository: socioRepository({ lookupByDocumento: async () => [] }),
      solicitudesRepository: solicitudesRepository(),
    });

    const result = await service.execute(
      [transition({ actionCode: "liquidar" }), transition({ actionCode: "confirmar" })],
      "sol-1",
    );

    assert.deepEqual(
      result.map((t) => ({ actionCode: t.actionCode, blockedReason: t.blockedReason !== null })),
      [
        { actionCode: "liquidar", blockedReason: true },
        { actionCode: "confirmar", blockedReason: true },
      ],
    );
  });
});

function transition(overrides: Partial<WorkflowTransition> = {}): WorkflowTransition {
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

function solicitudWithTitularOverrides(
  titularOverrides: Partial<{
    celular: string | null;
    email: string | null;
    fechaNacimiento: string | null;
    sexo: string | null;
  }> = {},
  solicitudOverrides: Partial<{ legacyOid: string | null }> = {},
) {
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
    legacyOid: solicitudOverrides.legacyOid ?? null,
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
      fechaNacimiento: null,
      localidad: null,
      nombre: "Juan",
      nroDocumento: "33.344.455",
      nroPuerta: null,
      nroSocio: null,
      sexo: null,
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
    findById: async () => solicitudWithTitularOverrides(),
    listByOwner: async () => [],
    update: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}
