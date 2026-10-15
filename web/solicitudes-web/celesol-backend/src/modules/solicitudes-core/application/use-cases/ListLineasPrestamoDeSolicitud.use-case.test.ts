import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import { SolicitudCoreNotFoundError } from "../../domain/solicitudes-core-errors";
import { ListLineasPrestamoDeSolicitudUseCase } from "./ListLineasPrestamoDeSolicitud.use-case";

const lineaCancel = {
  cantidadMaximaCuotas: 24,
  cantidadMinimaCuotas: 1,
  descripcion: "CRUZ DEL EJE -Cancel-Prem",
  montoMaximo: 6000000,
  montoMinimo: null,
  oid: "2703",
  tasa: 0.0895,
  vigente: true,
};

describe("ListLineasPrestamoDeSolicitudUseCase", () => {
  it("devuelve las lineas del agente del vendedor de la solicitud", async () => {
    let consultadoCon: string | null = null;
    const useCase = new ListLineasPrestamoDeSolicitudUseCase({
      lineasPrestamoCatalog: {
        listVigentesByLegacyUser: async (legacyUser) => {
          consultadoCon = legacyUser;
          return [lineaCancel];
        },
      },
      repository: {
        findById: async () => ({ id: "sol-1" }) as SolicitudCore,
        findVendedorLegacyUser: async () => "vendedor-cruz",
      },
    });

    const lineas = await useCase.execute({ solicitudId: "sol-1" });

    assert.equal(consultadoCon, "vendedor-cruz");
    assert.deepEqual(lineas, [lineaCancel]);
  });

  it("devuelve vacio si la solicitud no tiene vendedor con usuario del legado", async () => {
    const useCase = new ListLineasPrestamoDeSolicitudUseCase({
      lineasPrestamoCatalog: {
        listVigentesByLegacyUser: async () => {
          throw new Error("not used");
        },
      },
      repository: {
        findById: async () => ({ id: "sol-1" }) as SolicitudCore,
        findVendedorLegacyUser: async () => null,
      },
    });

    assert.deepEqual(await useCase.execute({ solicitudId: "sol-1" }), []);
  });

  it("falla si la solicitud no existe", async () => {
    const useCase = new ListLineasPrestamoDeSolicitudUseCase({
      lineasPrestamoCatalog: { listVigentesByLegacyUser: async () => [] },
      repository: {
        findById: async () => null,
        findVendedorLegacyUser: async () => null,
      },
    });

    await assert.rejects(
      () => useCase.execute({ solicitudId: "sol-404" }),
      SolicitudCoreNotFoundError,
    );
  });
});
