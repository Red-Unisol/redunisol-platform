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
  it("mantiene el catálogo para simular y marca qué líneas se pueden asignar al editar", async () => {
    const celesol = { ...lineaCancel, oid: "2519" };
    const actual = { ...lineaCancel, oid: "2773" };
    const inhabilitada = { ...lineaCancel, oid: "2775" };
    let consultadoCon: string | null = null;
    const useCase = new ListLineasPrestamoDeSolicitudUseCase({
      getAmejucaVariant: async () => "CELESOL",
      lineasPrestamoCatalog: {
        listVigentesByLegacyUser: async (legacyUser) => {
          consultadoCon = legacyUser;
          return [lineaCancel, celesol, actual, inhabilitada];
        },
      },
      repository: {
        findById: async () =>
          ({ id: "sol-1", lineaPrestamoLegacyOid: actual.oid }) as SolicitudCore,
        findVendedorLegacyUser: async () => "vendedor-cruz",
      },
    });

    const lineas = await useCase.execute({ solicitudId: "sol-1" });

    assert.equal(consultadoCon, "vendedor-cruz");
    assert.deepEqual(lineas, [
      { ...lineaCancel, asignable: true },
      { ...celesol, asignable: true },
      { ...actual, asignable: true },
      { ...inhabilitada, asignable: false },
    ]);
  });

  it("devuelve vacio si la solicitud no tiene vendedor con usuario del legado", async () => {
    const useCase = new ListLineasPrestamoDeSolicitudUseCase({
      getAmejucaVariant: async () => "CELESOL",
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
      getAmejucaVariant: async () => "CELESOL",
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
