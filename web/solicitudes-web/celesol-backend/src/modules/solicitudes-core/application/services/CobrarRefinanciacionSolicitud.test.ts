import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { refinanciacionVersion } from "../../domain/repositories/SolicitudRefinanciacionRepository";
import { AdministrativeCorrectionError } from "../../domain/workflow/AdministrativeCorrection";

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

// Plan del prestamo 416228 de FapiTest: la 22 vencida, la 23 del mes y las
// siguientes futuras, con "hoy" = 28/10/2026.
const CUOTAS_416228 = [
  { fecha: "2026-09-30", nroCuota: 22 },
  { fecha: "2026-10-31", nroCuota: 23 },
  { fecha: "2026-11-30", nroCuota: 24 },
  { fecha: "2026-12-31", nroCuota: 25 },
];

describe("CobrarRefinanciacionSolicitud", () => {
  it("prepares only the cuotas not charged yet and adds what was", async () => {
    const simulados: unknown[] = [];
    const servicio = build({
      guardados: [
        guardado("416209", [22, 23], [cobro("18868290", [22, 23], 1194285.46)]),
        guardado("416228", [22, 23, 24], [cobro("18868400", [22], 142811.53)]),
      ],
      simular: async (input) => {
        simulados.push(input);
        return { prestamos: [ok("416228", 164350.88)], total: 164350.88 };
      },
    });

    const preparada = await servicio.preparar("sol-1");

    assert.deepEqual(simulados, [
      {
        prestamos: [{ nrosCuota: [23, 24], prestamoId: "416228" }],
        solicitudId: "sol-1",
      },
    ]);
    assert.deepEqual(preparada.pendientes, [
      { nrosCuota: [23, 24], prestamoId: "416228" },
    ]);
    assert.equal(preparada.total, 1501447.87);
  });

  it("does not simulate when everything was already charged", async () => {
    let simulo = false;
    const servicio = build({
      guardados: [guardado("416209", [22], [cobro("1", [22], 100)])],
      simular: async () => {
        simulo = true;
        return { prestamos: [], total: 0 };
      },
    });

    const preparada = await servicio.preparar("sol-1");

    assert.equal(simulo, false);
    assert.deepEqual(preparada, { pendientes: [], total: 100, version: refinanciacionVersion({ prestamos: [guardado("416209", [22], [cobro("1", [22], 100)])], updatedAt: null }) });
  });

  it("stops before charging when Vimarx would reject a prestamo", async () => {
    const servicio = build({
      guardados: [guardado("414805", [25])],
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

  it("charges overdue cuotas apart, with punitorios, and records each cobro", async () => {
    const cobros: CobrarPrestamoInput[] = [];
    const registrados: unknown[] = [];
    const servicio = build({
      cobrar: async (input) => {
        cobros.push(input);
        return { cobroId: `PG-${input.nrosCuota.join("-")}`, totalPago: 100 };
      },
      onAgregarCobro: (input) => registrados.push(input),
    });

    await servicio.cobrar("sol-1", {
      version: "test",
      pendientes: [{ nrosCuota: [22, 23, 24, 25], prestamoId: "416228" }],
      total: 200,
    });

    assert.deepEqual(
      cobros.map((item) => [
        item.nrosCuota,
        item.permitePagoFueraDeOrden,
        item.simulacion,
        item.motivo,
        item.cobradorId,
      ]),
      [
        [[22], false, false, 1, 65],
        [[23, 24, 25], true, false, 1, 65],
      ],
    );
    assert.deepEqual(registrados, [
      {
        cobro: { cobroId: "PG-22", nrosCuota: [22], totalCobrado: 100 },
        prestamoId: "416228",
        solicitudId: "sol-1",
      },
      {
        cobro: { cobroId: "PG-23-24-25", nrosCuota: [23, 24, 25], totalCobrado: 100 },
        prestamoId: "416228",
        solicitudId: "sol-1",
      },
    ]);
  });

  it("keeps what was charged and reports the cobro that failed", async () => {
    const registrados: number[][] = [];
    const servicio = build({
      cobrar: async (input) => {
        if (input.permitePagoFueraDeOrden) {
          throw new PrestamoLegacyRechazadoError("No se pudo cobrar.");
        }

        return { cobroId: "PG-1", totalPago: 100 };
      },
      onAgregarCobro: (input) => registrados.push(input.cobro.nrosCuota),
    });

    await assert.rejects(
      () =>
        servicio.cobrar("sol-1", {
          version: "test",
          pendientes: [{ nrosCuota: [22, 23], prestamoId: "416228" }],
          total: 200,
        }),
      (error: unknown) =>
        error instanceof SolicitudRefinanciacionCobroIncompletoError &&
        error.message.startsWith("Se hicieron 1 de 2 cobros") &&
        error.message.includes("Vimarx rechazó las cuotas 23 del préstamo 416228"),
    );
    assert.deepEqual(registrados, [[22]]);
  });

  it("asks to check Vimarx when the answer of a cobro is lost", async () => {
    // Sin respuesta no se sabe si Vimarx lo registro: no se marca cobrado.
    let registro = false;
    const servicio = build({
      cobrar: async () => {
        throw new PrestamoLegacyUnavailableError();
      },
      onAgregarCobro: () => {
        registro = true;
      },
    });

    await assert.rejects(
      () =>
        servicio.cobrar("sol-1", {
          version: "test",
          pendientes: [{ nrosCuota: [24], prestamoId: "416228" }],
          total: 100,
        }),
      (error: unknown) =>
        error instanceof AdministrativeCorrectionError &&
        error.message.includes("quedó bloqueada"),
    );
    assert.equal(registro, false);
  });
});

function cobro(cobroId: string, nrosCuota: number[], totalCobrado: number) {
  return { cobradoAt: new Date(0), cobroId, nrosCuota, totalCobrado };
}

function guardado(
  prestamoId: string,
  nrosCuota: number[],
  cobros: ReturnType<typeof cobro>[] = [],
): SolicitudRefinanciacionPrestamoGuardado {
  return { cobros, nrosCuota, prestamoId };
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
    onAgregarCobro?: (input: {
      cobro: { cobroId: string; nrosCuota: number[]; totalCobrado: number };
      prestamoId: string;
      solicitudId: string;
    }) => void;
    simular?: (input: unknown) => Promise<RefinanciacionSimulada>;
  } = {},
) {
  return new CobrarRefinanciacionSolicitud({
    cobrarPrestamoGateway: {
      cobrar: (async (input: CobrarPrestamoInput) => {
        const resultado = await (overrides.cobrar ??
          (async () => ({ cobroId: "PG-1", totalPago: 0 })))(input);

        return {
          capital: 0,
          cobroId: resultado.cobroId,
          cuotas: [],
          interes: 0,
          otros: 0,
          punitorios: 0,
          totalPago: resultado.totalPago,
        };
      }) as never,
    },
    hoy: () => "2026-10-28",
    legacyGateway: {
      listCuotasDelPrestamo: (async () => CUOTAS_416228) as never,
    },
    registroCobros: {
      iniciar: async (input) => JSON.stringify(input),
      confirmar: async (solicitudId, operationId, cobro) => { const input = JSON.parse(operationId); overrides.onAgregarCobro?.({ solicitudId, prestamoId: input.prestamoId, cobro }); },
      rechazar: async () => {},
      marcarIncierto: async () => {},
    },
    refinanciacionRepository: {
      findBySolicitudId: async () => ({
        prestamos: overrides.guardados ?? [],
        updatedAt: null,
      }),
    },
    simularRefinanciacion: {
      execute: (overrides.simular ??
        (async () => ({ prestamos: [], total: 0 }))) as never,
    },
  });
}
