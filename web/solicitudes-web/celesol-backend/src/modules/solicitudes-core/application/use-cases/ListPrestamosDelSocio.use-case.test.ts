import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ListPrestamosDelSocioUseCase } from "./ListPrestamosDelSocio.use-case";
import { SolicitudCoreNotFoundError } from "../../domain/solicitudes-core-errors";
import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";

const TITULAR = {
  cuit: null,
  nroDocumento: "30111222",
  tipoDocumento: "DNI",
};

describe("ListPrestamosDelSocioUseCase", () => {
  it("asks the legacy system for the loans of the titular socio", async () => {
    let recibido: string | undefined;
    const useCase = buildUseCase({
      legacyGateway: {
        listPrestamosDelSocio: async (socioLegacyId: string) => {
          recibido = socioLegacyId;
          return [prestamo()];
        },
      },
    });

    const prestamos = await useCase.execute({ solicitudId: "sol-1" });

    assert.equal(recibido, "143471");
    assert.equal(prestamos.length, 1);
    assert.equal(prestamos[0].vigente, true);
  });

  it("throws when the solicitud does not exist", async () => {
    const useCase = buildUseCase({ solicitud: null });

    await assert.rejects(
      () => useCase.execute({ solicitudId: "sol-1" }),
      SolicitudCoreNotFoundError,
    );
  });

  it("returns empty when the titular is not a socio yet", async () => {
    // Caso normal, no un error: se puede cargar una solicitud de alguien que
    // todavia no esta en el padron.
    let llamado = false;
    const useCase = buildUseCase({
      legacyGateway: {
        listPrestamosDelSocio: async () => {
          llamado = true;
          return [];
        },
      },
      socios: [],
    });

    assert.deepEqual(await useCase.execute({ solicitudId: "sol-1" }), []);
    assert.equal(llamado, false);
  });

  it("returns empty when the socio has no legacy number", async () => {
    let llamado = false;
    const useCase = buildUseCase({
      legacyGateway: {
        listPrestamosDelSocio: async () => {
          llamado = true;
          return [];
        },
      },
      socios: [{ nroSocioLegacy: null }],
    });

    assert.deepEqual(await useCase.execute({ solicitudId: "sol-1" }), []);
    assert.equal(llamado, false);
  });

  it("does not call the legacy system with a non numeric socio number", async () => {
    // El numero se interpola en la expresion de criterios del legado.
    let llamado = false;
    const useCase = buildUseCase({
      legacyGateway: {
        listPrestamosDelSocio: async () => {
          llamado = true;
          return [];
        },
      },
      socios: [{ nroSocioLegacy: "143471 OR 1=1" }],
    });

    assert.deepEqual(await useCase.execute({ solicitudId: "sol-1" }), []);
    assert.equal(llamado, false);
  });
});

function prestamo() {
  return {
    capital: 923230,
    fechaEmision: "2024-11-14T00:00:00",
    legacyId: "416374",
    lineaPrestamoDescripcion: "LINEA MUCI 24-36",
    montoPrestamo: 3132021.7,
    nroCuenta: "998451",
    primerVencimiento: "2024-11-30T00:00:00",
    saldo: -1234703.98,
    vencimiento: "2027-11-01T00:00:00",
    vigente: true,
  };
}

function buildUseCase(
  overrides: {
    legacyGateway?: { listPrestamosDelSocio: (id: string) => Promise<ReturnType<typeof prestamo>[]> };
    socios?: { nroSocioLegacy: string | null }[];
    solicitud?: unknown;
  } = {},
) {
  const socios =
    overrides.socios ?? [{ nroSocioLegacy: "143471" }];
  const solicitud =
    overrides.solicitud === undefined
      ? { id: "sol-1", titular: TITULAR }
      : overrides.solicitud;

  return new ListPrestamosDelSocioUseCase({
    legacyGateway:
      overrides.legacyGateway ?? { listPrestamosDelSocio: async () => [] },
    repository: { findById: async () => solicitud } as never,
    sociosRepository: {
      lookupByDocumento: async () => socios,
    } as unknown as SocioRepository,
  });
}
