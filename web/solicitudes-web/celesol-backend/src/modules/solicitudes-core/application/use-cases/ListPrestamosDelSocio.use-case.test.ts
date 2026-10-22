import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ListPrestamosDelSocioUseCase } from "./ListPrestamosDelSocio.use-case";
import { SolicitudCoreNotFoundError } from "../../domain/solicitudes-core-errors";

const TITULAR = {
  cuit: null,
  nroDocumento: "30111222",
  tipoDocumento: "DNI",
};

describe("ListPrestamosDelSocioUseCase", () => {
  it("looks up the titular in the legacy padron and asks for its loans", async () => {
    const llamadas: string[] = [];
    const useCase = buildUseCase({
      lookupSocioRapido: async (documento, tipoDocumento) => {
        llamadas.push(`socio ${documento} ${tipoDocumento}`);
        return [{ id: "143471" }];
      },
      listPrestamosDelSocio: async (socioLegacyId) => {
        llamadas.push(`prestamos ${socioLegacyId}`);
        return [prestamo()];
      },
    });

    const prestamos = await useCase.execute({ solicitudId: "sol-1" });

    assert.deepEqual(llamadas, ["socio 30111222 DNI", "prestamos 143471"]);
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
      lookupSocioRapido: async () => [],
      listPrestamosDelSocio: async () => {
        llamado = true;
        return [];
      },
    });

    assert.deepEqual(await useCase.execute({ solicitudId: "sol-1" }), []);
    assert.equal(llamado, false);
  });

  it("falls back to the CUIT when the document does not match", async () => {
    // Las juridicas tienen el CUIT en NroDoc.
    const buscados: string[] = [];
    const useCase = buildUseCase({
      lookupSocioRapido: async (documento) => {
        buscados.push(documento);
        return documento === "30711222339" ? [{ id: "152199" }] : [];
      },
      listPrestamosDelSocio: async () => [prestamo()],
      solicitud: {
        id: "sol-1",
        titular: { cuit: "30-71122233-9", nroDocumento: null, tipoDocumento: null },
      },
    });

    assert.equal((await useCase.execute({ solicitudId: "sol-1" })).length, 1);
    assert.deepEqual(buscados, ["30711222339"]);
  });

  it("does not pick a socio when the document matches more than one", async () => {
    // Mostrar los prestamos de otra persona es peor que no mostrar nada.
    let llamado = false;
    const useCase = buildUseCase({
      lookupSocioRapido: async () => [{ id: "1" }, { id: "2" }],
      listPrestamosDelSocio: async () => {
        llamado = true;
        return [];
      },
    });

    assert.deepEqual(await useCase.execute({ solicitudId: "sol-1" }), []);
    assert.equal(llamado, false);
  });

  it("does not query the legacy system with a non numeric document", async () => {
    // El documento se interpola en la expresion de criterios del legado.
    let llamado = false;
    const useCase = buildUseCase({
      lookupSocioRapido: async () => {
        llamado = true;
        return [];
      },
      solicitud: {
        id: "sol-1",
        titular: { cuit: null, nroDocumento: "1 OR 1=1", tipoDocumento: "DNI" },
      },
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
    montoADesembolsar: 800000,
    montoPrestamo: 3132021.7,
    nroCuenta: "998451",
    primerVencimiento: "2024-11-30T00:00:00",
    saldo: -1234703.98,
    vencimiento: "2027-11-01T00:00:00",
    vigente: true,
    estado: 0,
  };
}

function buildUseCase(
  overrides: {
    listPrestamosDelSocio?: (id: string) => Promise<ReturnType<typeof prestamo>[]>;
    lookupSocioRapido?: (
      documento: string,
      tipoDocumento?: string,
    ) => Promise<{ id: string }[]>;
    solicitud?: unknown;
  } = {},
) {
  const solicitud =
    overrides.solicitud === undefined
      ? { id: "sol-1", titular: TITULAR }
      : overrides.solicitud;

  return new ListPrestamosDelSocioUseCase({
    legacyGateway: {
      listPrestamosDelSocio:
        overrides.listPrestamosDelSocio ?? (async () => []),
      lookupSocioRapido:
        overrides.lookupSocioRapido ?? (async () => [{ id: "143471" }]),
    } as never,
    repository: { findById: async () => solicitud } as never,
  });
}
