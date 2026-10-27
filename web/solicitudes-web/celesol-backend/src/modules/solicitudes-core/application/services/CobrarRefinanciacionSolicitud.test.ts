import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CobrarRefinanciacionSolicitud } from "./CobrarRefinanciacionSolicitud";
import {
  PrestamoLegacyRechazadoError,
  PrestamoLegacyUnavailableError,
  SolicitudRefinanciacionCobroIncompletoError,
  SolicitudRefinanciacionInvalidaError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudRefinanciacionPrestamoGuardado } from "../../domain/repositories/SolicitudRefinanciacionRepository";
import type { CobrarPrestamoInput } from "../../infrastructure/services/CobrarPrestamoGateway";
import type { RefinanciacionSimulada } from "../use-cases/SimularRefinanciacion.use-case";

describe("CobrarRefinanciacionSolicitud", () => {
  it("prepares only what was not charged yet and adds what was", async () => {
    const simulados: unknown[] = [];
    const servicio = build({
      guardados: [cobrado("416209", 1194285.46), pendiente("414805", [24, 25])],
      simular: async (input) => {
        simulados.push(input);
        return { prestamos: [ok("414805", 57945.57)], total: 57945.57 };
      },
    });

    const preparada = await servicio.preparar("sol-1");

    assert.deepEqual(simulados, [
      {
        prestamos: [{ nrosCuota: [24, 25], prestamoId: "414805" }],
        solicitudId: "sol-1",
      },
    ]);
    assert.deepEqual(
      preparada.pendientes.map((prestamo) => prestamo.prestamoId),
      ["414805"],
    );
    assert.equal(preparada.total, 1252231.03);
  });

  it("does not simulate when there is nothing pending", async () => {
    let simulo = false;
    const servicio = build({
      guardados: [],
      simular: async () => {
        simulo = true;
        return { prestamos: [], total: 0 };
      },
    });

    const preparada = await servicio.preparar("sol-1");

    assert.equal(simulo, false);
    assert.deepEqual(preparada, { pendientes: [], total: 0 });
  });

  it("stops before charging when Vimarx would reject a prestamo", async () => {
    const servicio = build({
      guardados: [pendiente("414805", [25])],
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
      () => servicio.preparar("sol-1"),
      (error: unknown) =>
        error instanceof SolicitudRefinanciacionInvalidaError &&
        error.message.startsWith(
          "Vimarx no acepta la refinanciación del préstamo 414805:",
        ),
    );
  });

  it("charges each pending prestamo for real and records it", async () => {
    const cobros: CobrarPrestamoInput[] = [];
    const registrados: unknown[] = [];
    const servicio = build({
      cobrar: async (input) => {
        cobros.push(input);
        return { cobroId: `PG-${input.prestamoId}`, totalPago: 100 };
      },
      onMarcarCobrado: (input) => registrados.push(input),
    });

    await servicio.cobrar("sol-1", {
      pendientes: [pendiente("414805", [24, 25]), pendiente("416209", [22])],
      total: 200,
    });

    assert.deepEqual(
      cobros.map((cobro) => [
        cobro.prestamoId,
        cobro.simulacion,
        cobro.motivo,
        cobro.cobradorId,
      ]),
      [
        ["414805", false, 1, 65],
        ["416209", false, 1, 65],
      ],
    );
    assert.deepEqual(registrados, [
      { cobroId: "PG-414805", prestamoId: "414805", solicitudId: "sol-1", totalCobrado: 100 },
      { cobroId: "PG-416209", prestamoId: "416209", solicitudId: "sol-1", totalCobrado: 100 },
    ]);
  });

  it("keeps what was charged and reports the one that failed", async () => {
    const registrados: string[] = [];
    const servicio = build({
      cobrar: async (input) => {
        if (input.prestamoId === "416209") {
          throw new PrestamoLegacyRechazadoError("No se pudo cobrar.");
        }

        return { cobroId: "PG-1", totalPago: 100 };
      },
      onMarcarCobrado: (input) => registrados.push(input.prestamoId),
    });

    await assert.rejects(
      () =>
        servicio.cobrar("sol-1", {
          pendientes: [pendiente("414805", [24]), pendiente("416209", [22])],
          total: 200,
        }),
      (error: unknown) =>
        error instanceof SolicitudRefinanciacionCobroIncompletoError &&
        error.message.startsWith("Se cobraron 1 de 2 préstamos") &&
        error.message.includes("Vimarx rechazó el préstamo 416209"),
    );
    assert.deepEqual(registrados, ["414805"]);
  });

  it("asks to check Vimarx when the answer of a cobro is lost", async () => {
    // Sin respuesta no se sabe si Vimarx lo registro: no se marca cobrado.
    const servicio = build({
      cobrar: async () => {
        throw new PrestamoLegacyUnavailableError();
      },
    });

    await assert.rejects(
      () =>
        servicio.cobrar("sol-1", {
          pendientes: [pendiente("414805", [24])],
          total: 100,
        }),
      (error: unknown) =>
        error instanceof SolicitudRefinanciacionCobroIncompletoError &&
        error.message.includes("revisá en Vimarx si sus cuotas quedaron cobradas"),
    );
  });
});

function pendiente(
  prestamoId: string,
  nrosCuota: number[],
): SolicitudRefinanciacionPrestamoGuardado {
  return { cobro: null, nrosCuota, prestamoId };
}

function cobrado(
  prestamoId: string,
  totalCobrado: number,
): SolicitudRefinanciacionPrestamoGuardado {
  return {
    cobro: { cobradoAt: new Date(0), cobroId: "18868290", totalCobrado },
    nrosCuota: [22, 23],
    prestamoId,
  };
}

function ok(prestamoId: string, totalPago: number) {
  return {
    cuotas: [],
    ok: true as const,
    otros: 0,
    prestamoId,
    punitorios: 0,
    totalPago,
  };
}

function build(
  overrides: {
    cobrar?: (
      input: CobrarPrestamoInput,
    ) => Promise<{ cobroId: string; totalPago: number }>;
    guardados?: SolicitudRefinanciacionPrestamoGuardado[];
    onMarcarCobrado?: (input: {
      cobroId: string;
      prestamoId: string;
      solicitudId: string;
      totalCobrado: number;
    }) => void;
    simular?: (input: unknown) => Promise<RefinanciacionSimulada>;
  } = {},
) {
  return new CobrarRefinanciacionSolicitud({
    cobrarPrestamoGateway: {
      cobrar: (async (input: CobrarPrestamoInput) => {
        const cobro = await (overrides.cobrar ??
          (async () => ({ cobroId: "PG-1", totalPago: 0 })))(input);

        return {
          capital: 0,
          cobroId: cobro.cobroId,
          cuotas: [],
          interes: 0,
          otros: 0,
          punitorios: 0,
          totalPago: cobro.totalPago,
        };
      }) as never,
    },
    refinanciacionRepository: {
      findBySolicitudId: async () => ({
        prestamos: overrides.guardados ?? [],
        updatedAt: null,
      }),
      marcarCobrado: async (input) => {
        overrides.onMarcarCobrado?.(input);
      },
    },
    simularRefinanciacion: {
      execute: (overrides.simular ??
        (async () => ({ prestamos: [], total: 0 }))) as never,
    },
  });
}
