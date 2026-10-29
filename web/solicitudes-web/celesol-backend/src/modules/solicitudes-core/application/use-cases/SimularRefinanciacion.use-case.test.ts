import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COBRADOR_REFINANCIACION_ID,
  MOTIVO_COBRO_REFINANCIACION,
  SimularRefinanciacionUseCase,
} from "./SimularRefinanciacion.use-case";
import {
  PrestamoDelSocioNotFoundError,
  PrestamoLegacyRechazadoError,
  PrestamoLegacyUnavailableError,
  SolicitudCoreNotFoundError,
} from "../../domain/solicitudes-core-errors";
import type { CobrarPrestamoInput } from "../../infrastructure/services/CobrarPrestamoGateway";

const TITULAR = {
  cuit: null,
  nroDocumento: "35578689",
  tipoDocumento: "DNI",
};

describe("SimularRefinanciacionUseCase", () => {
  it("simulates each prestamo with the refinanciacion motivo and cobrador", async () => {
    const cobros: CobrarPrestamoInput[] = [];
    const useCase = buildUseCase({
      cobrar: async (input) => {
        cobros.push(input);
        return cobro(input.prestamoId === "414805" ? 57945.57 : 1000.1);
      },
    });

    const result = await useCase.execute({
      prestamos: [
        { nrosCuota: [25, 24], prestamoId: "414805" },
        { nrosCuota: [3], prestamoId: "420000" },
      ],
      solicitudId: "sol-1",
    });

    assert.deepEqual(cobros, [
      {
        cobradorId: COBRADOR_REFINANCIACION_ID,
        motivo: MOTIVO_COBRO_REFINANCIACION,
        nrosCuota: [24, 25],
        // Sin fecha conocida no estan vencidas: van fuera de orden.
        permitePagoFueraDeOrden: true,
        prestamoId: "414805",
        simulacion: true,
      },
      {
        cobradorId: COBRADOR_REFINANCIACION_ID,
        motivo: MOTIVO_COBRO_REFINANCIACION,
        nrosCuota: [3],
        permitePagoFueraDeOrden: true,
        prestamoId: "420000",
        simulacion: true,
      },
    ]);
    assert.equal(COBRADOR_REFINANCIACION_ID, 65);
    assert.equal(MOTIVO_COBRO_REFINANCIACION, 1);
    assert.equal(result.total, 58945.67);
    assert.equal(result.prestamos.length, 2);
  });

  it("charges overdue cuotas in order and the rest out of order", async () => {
    // Con "pago fuera de orden" Vimarx no cobra punitorios: las vencidas van
    // aparte, sin esa opcion. Caso real de FapiTest: prestamo 416228.
    const cobros: CobrarPrestamoInput[] = [];
    const useCase = buildUseCase({
      cobrar: async (input) => {
        cobros.push(input);
        return input.permitePagoFueraDeOrden
          ? { ...cobro(205167.66), otros: 191527.98 }
          : { ...cobro(142811.53), otros: 3483.21, punitorios: 7096.44 };
      },
      cuotas: [
        { fecha: "2026-09-30", nroCuota: 22 },
        { fecha: "2026-10-31", nroCuota: 23 },
        { fecha: "2026-11-30", nroCuota: 24 },
        { fecha: "2026-12-31", nroCuota: 25 },
      ],
    });

    const result = await useCase.execute({
      prestamos: [{ nrosCuota: [25, 22, 24, 23], prestamoId: "416228" }],
      solicitudId: "sol-1",
    });

    assert.deepEqual(
      cobros.map((item) => [item.nrosCuota, item.permitePagoFueraDeOrden]),
      [
        [[22], false],
        [[23, 24, 25], true],
      ],
    );
    assert.equal(result.total, 347979.19);
    assert.deepEqual(result.prestamos[0], {
      cuotas: [],
      ok: true,
      otros: 195011.19,
      prestamoId: "416228",
      punitorios: 7096.44,
      totalPago: 347979.19,
    });
  });

  it("reports a legacy rejection on its prestamo and leaves the total empty", async () => {
    const useCase = buildUseCase({
      cobrar: async (input) => {
        if (input.prestamoId === "420000") {
          throw new PrestamoLegacyRechazadoError(
            "Deben Pagarse 1 cuota/s en prt 1, comenzando por la cuota nro 2",
          );
        }

        return cobro(100);
      },
    });

    const result = await useCase.execute({
      prestamos: [
        { nrosCuota: [1], prestamoId: "414805" },
        { nrosCuota: [3], prestamoId: "420000" },
      ],
      solicitudId: "sol-1",
    });

    assert.equal(result.total, null);
    assert.deepEqual(result.prestamos[1], {
      error: "Deben Pagarse 1 cuota/s en prt 1, comenzando por la cuota nro 2",
      ok: false,
      prestamoId: "420000",
    });
  });

  it("fails entirely when the legacy system does not answer", async () => {
    const useCase = buildUseCase({
      cobrar: async () => {
        throw new PrestamoLegacyUnavailableError();
      },
    });

    await assert.rejects(
      () =>
        useCase.execute({
          prestamos: [{ nrosCuota: [1], prestamoId: "414805" }],
          solicitudId: "sol-1",
        }),
      PrestamoLegacyUnavailableError,
    );
  });

  it("does not simulate anything when one prestamo is not the socio's", async () => {
    // Es lo que impide cobrar el prestamo de otra persona cambiando el ID.
    let simulo = false;
    const useCase = buildUseCase({
      cobrar: async () => {
        simulo = true;
        return cobro(1);
      },
      getPrestamoDelSocio: async (_socio, prestamoId) =>
        prestamoId === "999" ? null : { legacyId: prestamoId },
    });

    await assert.rejects(
      () =>
        useCase.execute({
          prestamos: [
            { nrosCuota: [1], prestamoId: "414805" },
            { nrosCuota: [1], prestamoId: "999" },
          ],
          solicitudId: "sol-1",
        }),
      PrestamoDelSocioNotFoundError,
    );
    assert.equal(simulo, false);
  });

  it("throws when the solicitud does not exist", async () => {
    const useCase = buildUseCase({ solicitud: null });

    await assert.rejects(
      () =>
        useCase.execute({
          prestamos: [{ nrosCuota: [1], prestamoId: "414805" }],
          solicitudId: "sol-1",
        }),
      SolicitudCoreNotFoundError,
    );
  });

  it("does not call the legacy system with a non numeric prestamo id", async () => {
    let llamado = false;
    const useCase = buildUseCase({
      getPrestamoDelSocio: async () => {
        llamado = true;
        return { legacyId: "1" };
      },
    });

    await assert.rejects(
      () =>
        useCase.execute({
          prestamos: [{ nrosCuota: [1], prestamoId: "414805 OR 1=1" }],
          solicitudId: "sol-1",
        }),
      PrestamoDelSocioNotFoundError,
    );
    assert.equal(llamado, false);
  });

  it("throws not found when the titular is not a socio yet", async () => {
    const useCase = buildUseCase({ socios: [] });

    await assert.rejects(
      () =>
        useCase.execute({
          prestamos: [{ nrosCuota: [1], prestamoId: "414805" }],
          solicitudId: "sol-1",
        }),
      PrestamoDelSocioNotFoundError,
    );
  });
});

function cobro(totalPago: number) {
  return {
    capital: 0,
    cobroId: "0",
    cuotas: [],
    interes: 0,
    otros: 0,
    punitorios: 0,
    totalPago,
  };
}

function buildUseCase(
  overrides: {
    cobrar?: (input: CobrarPrestamoInput) => Promise<ReturnType<typeof cobro>>;
    cuotas?: { fecha: string | null; nroCuota: number | null }[];
    getPrestamoDelSocio?: (
      socioLegacyId: string,
      prestamoLegacyId: string,
    ) => Promise<{ legacyId: string } | null>;
    socios?: { id: string }[];
    solicitud?: unknown;
  } = {},
) {
  const socios = overrides.socios ?? [{ id: "146871" }];
  const solicitud =
    overrides.solicitud === undefined
      ? { id: "sol-1", titular: TITULAR }
      : overrides.solicitud;

  return new SimularRefinanciacionUseCase({
    cobrarPrestamoGateway: {
      cobrar: overrides.cobrar ?? (async () => cobro(0)),
    },
    hoy: () => "2026-10-28",
    legacyGateway: {
      getPrestamoDelSocio: (overrides.getPrestamoDelSocio ??
        (async (_socio: string, prestamoId: string) => ({
          legacyId: prestamoId,
        }))) as never,
      listCuotasDelPrestamo: (async () => overrides.cuotas ?? []) as never,
      // El socio del titular se busca en el padron de Vimarx.
      lookupSocioRapido: async () => socios,
    },
    repository: { findById: async () => solicitud } as never,
  });
}
