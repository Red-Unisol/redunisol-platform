import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SolicitudNotFoundError } from "../../domain/solicitudes-errors";
import type { SolicitudesLegacyGateway } from "../../domain/services/SolicitudesLegacyGateway";
import { GetSolicitudDetailByOidUseCase } from "./GetSolicitudDetailByOid.use-case";

describe("GetSolicitudDetailByOidUseCase", () => {
  it("returns the first mapped detail row", async () => {
    const useCase = new GetSolicitudDetailByOidUseCase({
      solicitudesGateway: {
        getDetailByOid: async () => [
          {
            conyuge: {},
            economicosLaborales: {},
            solicitud: {
              lineaPrestamoDescripcion: "CLUB MUTUAL UNC CBU (920)",
            },
            titular: {},
          },
        ],
      } as unknown as SolicitudesLegacyGateway,
    });

    const detail = await useCase.execute({ oid: "239050" });

    assert.equal(
      detail.solicitud.lineaPrestamoDescripcion,
      "CLUB MUTUAL UNC CBU (920)",
    );
  });

  it("throws not found when legacy returns no rows", async () => {
    const useCase = new GetSolicitudDetailByOidUseCase({
      solicitudesGateway: {
        getDetailByOid: async () => [],
      } as unknown as SolicitudesLegacyGateway,
    });

    await assert.rejects(
      () => useCase.execute({ oid: "239050" }),
      SolicitudNotFoundError,
    );
  });
});
