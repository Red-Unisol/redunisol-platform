import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GuardarSolicitudRefinanciacionUseCase } from "./GuardarSolicitudRefinanciacion.use-case";
import type { RefinanciacionSimulada } from "./SimularRefinanciacion.use-case";
import {
  SolicitudCoreNotFoundError,
  SolicitudRefinanciacionInvalidaError,
  SolicitudRefinanciacionNoEditableError,
  SolicitudRefinanciacionPrestamoGeneradoError,
  SolicitudRefinanciacionYaCobradaError,
} from "../../domain/solicitudes-core-errors";
import type {
  SolicitudRefinanciacionPrestamo,
  SolicitudRefinanciacionPrestamoGuardado,
} from "../../domain/repositories/SolicitudRefinanciacionRepository";

const OWNER_RIESGO = "owner-riesgo";

describe("GuardarSolicitudRefinanciacionUseCase", () => {
  it("saves the cuotas after Vimarx accepts the simulation", async () => {
    const guardados: unknown[] = [];
    const simulados: unknown[] = [];
    const useCase = buildUseCase({
      onReplace: (input) => guardados.push(input),
      simular: async (input) => {
        simulados.push(input);
        return simulacionOk();
      },
    });

    const result = await useCase.execute({
      currentUser: riesgoUser(),
      prestamos: [{ nrosCuota: [25, 24], prestamoId: " 414805 " }],
      solicitudId: "sol-1",
    });

    const esperado = [{ nrosCuota: [24, 25], prestamoId: "414805" }];
    assert.deepEqual(simulados, [{ prestamos: esperado, solicitudId: "sol-1" }]);
    assert.deepEqual(guardados, [
      { prestamos: esperado, solicitudId: "sol-1", updatedBy: "user-1" },
    ]);
    assert.equal(result.simulacion?.total, 57945.57);
  });

  it("does not save what Vimarx would not accept", async () => {
    let guardo = false;
    const useCase = buildUseCase({
      onReplace: () => {
        guardo = true;
      },
      simular: async () => ({
        prestamos: [
          {
            error: "Deben Pagarse 1 cuota/s en prt 997107, comenzando por la cuota nro 24",
            ok: false,
            prestamoId: "414805",
          },
        ],
        total: null,
      }),
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: riesgoUser(),
          prestamos: [{ nrosCuota: [25], prestamoId: "414805" }],
          solicitudId: "sol-1",
        }),
      (error: unknown) =>
        error instanceof SolicitudRefinanciacionInvalidaError &&
        error.message.includes("comenzando por la cuota nro 24"),
    );
    assert.equal(guardo, false);
  });

  it("clears the selection without asking Vimarx", async () => {
    let simulo = false;
    const guardados: unknown[] = [];
    const useCase = buildUseCase({
      onReplace: (input) => guardados.push(input),
      simular: async () => {
        simulo = true;
        return simulacionOk();
      },
    });

    const result = await useCase.execute({
      currentUser: riesgoUser(),
      prestamos: [],
      solicitudId: "sol-1",
    });

    assert.equal(simulo, false);
    assert.deepEqual(guardados, [
      { prestamos: [], solicitudId: "sol-1", updatedBy: "user-1" },
    ]);
    assert.equal(result.simulacion, null);
  });

  it("rejects changes once the prestamo was generated", async () => {
    let simulo = false;
    const useCase = buildUseCase({
      simular: async () => {
        simulo = true;
        return simulacionOk();
      },
      solicitud: solicitud({ legacyOid: "441211" }),
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: riesgoUser(),
          prestamos: [],
          solicitudId: "sol-1",
        }),
      SolicitudRefinanciacionPrestamoGeneradoError,
    );
    assert.equal(simulo, false);
  });

  it("rejects a user that is not the current owner of the solicitud", async () => {
    let guardo = false;
    const useCase = buildUseCase({
      onReplace: () => {
        guardo = true;
      },
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: {
            id: "user-2",
            workflowOwnerCode: "TESORERIA",
            workflowOwnerId: "owner-tesoreria",
          },
          prestamos: [],
          solicitudId: "sol-1",
        }),
      SolicitudRefinanciacionNoEditableError,
    );
    assert.equal(guardo, false);
  });

  it("lets the owner edit when the state allows managing cancelaciones", async () => {
    // Mismo permiso que las cancelaciones: el owner del estado, si la regla
    // del estado habilita los adjuntos y cancelaciones.
    const useCase = buildUseCase({
      canManageAttachments: true,
      solicitud: solicitud({ ownerCode: "TESORERIA", ownerId: "owner-tesoreria" }),
    });

    const result = await useCase.execute({
      currentUser: {
        id: "user-2",
        workflowOwnerCode: "TESORERIA",
        workflowOwnerId: "owner-tesoreria",
      },
      prestamos: [],
      solicitudId: "sol-1",
    });

    assert.deepEqual(result.prestamos, []);
  });

  it("rejects changes once some cuotas were already charged in Vimarx", async () => {
    let guardo = false;
    const useCase = buildUseCase({
      cobrados: [
        {
          cobros: [
            {
              cobradoAt: new Date(0),
              cobroId: "18868290",
              nrosCuota: [22, 23],
              totalCobrado: 1194285.46,
            },
          ],
          nrosCuota: [22, 23],
          prestamoId: "416209",
        },
      ],
      onReplace: () => {
        guardo = true;
      },
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: riesgoUser(),
          prestamos: [],
          solicitudId: "sol-1",
        }),
      SolicitudRefinanciacionYaCobradaError,
    );
    assert.equal(guardo, false);
  });

  it("throws when the solicitud does not exist", async () => {
    const useCase = buildUseCase({ solicitud: null });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: riesgoUser(),
          prestamos: [],
          solicitudId: "sol-1",
        }),
      SolicitudCoreNotFoundError,
    );
  });
});

function riesgoUser() {
  return {
    id: "user-1",
    workflowOwnerCode: "RIESGO",
    workflowOwnerId: OWNER_RIESGO,
  };
}

function solicitud(
  overrides: { legacyOid?: string | null; ownerCode?: string; ownerId?: string } = {},
) {
  return {
    estadoActual: {
      code: "EnAnalisis",
      id: "estado-1",
      owner: { code: overrides.ownerCode ?? "RIESGO" },
      ownerId: overrides.ownerId ?? OWNER_RIESGO,
    },
    id: "sol-1",
    legacyOid: overrides.legacyOid ?? null,
  };
}

function simulacionOk(): RefinanciacionSimulada {
  return {
    prestamos: [
      {
        cuotas: [],
        ok: true,
        otros: 1413.31,
        prestamoId: "414805",
        punitorios: 1122.06,
        totalPago: 57945.57,
      },
    ],
    total: 57945.57,
  };
}

function buildUseCase(
  overrides: {
    canManageAttachments?: boolean;
    cobrados?: SolicitudRefinanciacionPrestamoGuardado[];
    onReplace?: (input: {
      prestamos: SolicitudRefinanciacionPrestamo[];
      solicitudId: string;
      updatedBy: string;
    }) => void;
    simular?: (input: unknown) => Promise<RefinanciacionSimulada>;
    solicitud?: unknown;
  } = {},
) {
  const target =
    overrides.solicitud === undefined ? solicitud() : overrides.solicitud;

  return new GuardarSolicitudRefinanciacionUseCase({
    fieldAccessRulesRepository: {
      findByWorkflowStateId: async () =>
        ({
          active: true,
          canManageAttachments: overrides.canManageAttachments ?? false,
          workflowStateId: "estado-1",
        }) as never,
    },
    refinanciacionRepository: {
      findBySolicitudId: async () => ({
        prestamos: overrides.cobrados ?? [],
        updatedAt: null,
      }),
      replace: async (input) => {
        overrides.onReplace?.(input);
        return {
          prestamos: input.prestamos.map((prestamo) => ({
            ...prestamo,
            cobros: [],
          })),
          updatedAt: new Date(0),
        };
      },
    },
    repository: { findById: async () => target } as never,
    simularRefinanciacion: {
      execute: (overrides.simular ?? (async () => simulacionOk())) as never,
    },
  });
}
