import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GetPrestamoDelSocioUseCase } from "./GetPrestamoDelSocio.use-case";
import {
  PrestamoDelSocioNotFoundError,
  SolicitudCoreNotFoundError,
} from "../../domain/solicitudes-core-errors";

const TITULAR = {
  cuit: null,
  nroDocumento: "35578689",
  tipoDocumento: "DNI",
};

describe("GetPrestamoDelSocioUseCase", () => {
  it("asks for the prestamo of the titular socio and then its installments", async () => {
    const llamadas: string[] = [];
    const useCase = buildUseCase({
      legacyGateway: {
        getPrestamoDelSocio: async (socioLegacyId, prestamoLegacyId) => {
          llamadas.push(`prestamo ${socioLegacyId} ${prestamoLegacyId}`);
          return prestamo();
        },
        listCuotasDelPrestamo: async (prestamoLegacyId) => {
          llamadas.push(`cuotas ${prestamoLegacyId}`);
          return [cuota()];
        },
      },
    });

    const detalle = await useCase.execute({
      prestamoId: "423331",
      solicitudId: "sol-1",
    });

    assert.deepEqual(llamadas, ["prestamo 146871 423331", "cuotas 423331"]);
    assert.equal(detalle.prestamo.ordenCompra, "90536");
    assert.equal(detalle.cuotas.length, 1);
    assert.equal(detalle.cuotas[0]?.fechaCobro, "2026-10-01T00:00:00");
  });

  it("throws when the solicitud does not exist", async () => {
    const useCase = buildUseCase({ solicitud: null });

    await assert.rejects(
      () => useCase.execute({ prestamoId: "423331", solicitudId: "sol-1" }),
      SolicitudCoreNotFoundError,
    );
  });

  it("does not ask for the installments of a prestamo that is not the socio's", async () => {
    // Es lo que impide ver el prestamo de otra persona cambiando la URL.
    let pidioCuotas = false;
    const useCase = buildUseCase({
      legacyGateway: {
        getPrestamoDelSocio: async () => null,
        listCuotasDelPrestamo: async () => {
          pidioCuotas = true;
          return [];
        },
      },
    });

    await assert.rejects(
      () => useCase.execute({ prestamoId: "999", solicitudId: "sol-1" }),
      PrestamoDelSocioNotFoundError,
    );
    assert.equal(pidioCuotas, false);
  });

  it("throws not found when the titular is not a socio yet", async () => {
    let llamado = false;
    const useCase = buildUseCase({
      legacyGateway: {
        getPrestamoDelSocio: async () => {
          llamado = true;
          return prestamo();
        },
        listCuotasDelPrestamo: async () => [],
      },
      socios: [],
    });

    await assert.rejects(
      () => useCase.execute({ prestamoId: "423331", solicitudId: "sol-1" }),
      PrestamoDelSocioNotFoundError,
    );
    assert.equal(llamado, false);
  });

  it("does not call the legacy system with non numeric ids", async () => {
    // Los dos numeros se interpolan en la expresion de criterios del legado.
    for (const caso of [
      { nroDocumento: "35578689", prestamoId: "423331 OR 1=1" },
      { nroDocumento: "35578689 OR 1=1", prestamoId: "423331" },
    ]) {
      let llamado = false;
      const useCase = buildUseCase({
        legacyGateway: {
          getPrestamoDelSocio: async () => {
            llamado = true;
            return prestamo();
          },
          listCuotasDelPrestamo: async () => [],
        },
        solicitud: {
          id: "sol-1",
          titular: { ...TITULAR, nroDocumento: caso.nroDocumento },
        },
      });

      await assert.rejects(
        () =>
          useCase.execute({
            prestamoId: caso.prestamoId,
            solicitudId: "sol-1",
          }),
        PrestamoDelSocioNotFoundError,
      );
      assert.equal(llamado, false);
    }
  });
});

function prestamo() {
  return {
    cuotas: 18,
    asiento: "1584",
    cobrador: "Haberes",
    destino: "Consumo",
    legacyId: "423331",
    lineaPrestamoDescripcion: "CRUZ DEL EJE -premium-",
    nroCuenta: "1004051",
    ordenCompra: "90536",
    tasaInicial: 0.1135,
  };
}

function cuota() {
  return {
    capital: 58770.31,
    fecha: "2025-08-31",
    fechaCobro: "2026-10-01T00:00:00",
    montoTotal: 419988.31,
    nroCuota: 1,
    saldoCuota: 0,
    saldoCuotaConPunitorios: 0,
  };
}

function buildUseCase(
  overrides: {
    legacyGateway?: {
      getPrestamoDelSocio: (
        socioLegacyId: string,
        prestamoLegacyId: string,
      ) => Promise<ReturnType<typeof prestamo> | null>;
      listCuotasDelPrestamo: (
        prestamoLegacyId: string,
      ) => Promise<ReturnType<typeof cuota>[]>;
    };
    socios?: { id: string }[];
    solicitud?: unknown;
  } = {},
) {
  const socios = overrides.socios ?? [{ id: "146871" }];
  const solicitud =
    overrides.solicitud === undefined
      ? { id: "sol-1", titular: TITULAR }
      : overrides.solicitud;

  return new GetPrestamoDelSocioUseCase({
    legacyGateway: {
      ...(overrides.legacyGateway ?? {
        getPrestamoDelSocio: async () => prestamo(),
        listCuotasDelPrestamo: async () => [],
      }),
      // El socio del titular se busca en el padron de Vimarx.
      lookupSocioRapido: async () => socios,
    },
    repository: { findById: async () => solicitud } as never,
  });
}
