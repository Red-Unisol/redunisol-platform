import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SolicitudCoreNotFoundError } from "../domain/solicitudes-core-errors";
import { crearVisibilidadVendedorGuard } from "./VisibilidadVendedorGuard";

const SOLICITUD_ID = "b3b3b3b3-1111-4222-8333-444444444444";

const vendedora = {
  id: "id-pcano",
  isSystemAdmin: false,
  legacyUser: "pcano",
  workflowOwner: { code: "VENDEDORES", id: "owner-v", name: "Vendedores" },
};

function armar(opciones: {
  creador?: string | null;
  usuario?: Record<string, unknown>;
  visibles?: string[];
}) {
  const consultas = { creador: 0, visibles: 0 };
  const guard = crearVisibilidadVendedorGuard({
    getCurrentUserUseCase: {
      execute: async () => (opciones.usuario ?? vendedora) as never,
    },
    repository: {
      findCreadorById: async () => {
        consultas.creador += 1;
        return opciones.creador === undefined ? "id-pcano" : opciones.creador;
      },
    },
    visibilidadVendedorResolver: {
      creadoresVisibles: async () => {
        consultas.visibles += 1;
        return opciones.visibles ?? ["id-pcano"];
      },
    },
  });

  async function correr(id: string) {
    let resultado: unknown = "sin llamar";
    await guard(
      { cookies: { accessToken: "t" }, params: { id } } as never,
      {} as never,
      (error?: unknown) => {
        resultado = error;
      },
    );
    return resultado;
  }

  return { consultas, correr };
}

describe("VisibilidadVendedorGuard", () => {
  it("deja pasar a un vendedor a una solicitud suya", async () => {
    const { correr } = armar({});

    assert.equal(await correr(SOLICITUD_ID), undefined);
  });

  it("responde no encontrada si la solicitud es de otro vendedor", async () => {
    const { correr } = armar({ creador: "id-camejuca" });

    assert.ok((await correr(SOLICITUD_ID)) instanceof SolicitudCoreNotFoundError);
  });

  it("deja pasar al dueño del agente a la solicitud de un vendedor suyo", async () => {
    const { correr } = armar({
      creador: "id-camejuca",
      visibles: ["id-nbrizuela", "id-camejuca", "id-pcano"],
    });

    assert.equal(await correr(SOLICITUD_ID), undefined);
  });

  it("no restringe a otras areas ni consulta nada", async () => {
    const { consultas, correr } = armar({
      creador: "id-camejuca",
      usuario: {
        ...vendedora,
        workflowOwner: { code: "RIESGO", id: "owner-r", name: "Riesgo" },
      },
    });

    assert.equal(await correr(SOLICITUD_ID), undefined);
    assert.deepEqual(consultas, { creador: 0, visibles: 0 });
  });

  it("no restringe a un admin", async () => {
    const { correr } = armar({
      creador: "id-camejuca",
      usuario: { ...vendedora, isSystemAdmin: true },
    });

    assert.equal(await correr(SOLICITUD_ID), undefined);
  });

  it("deja seguir si la solicitud no existe, para que el endpoint responda su 404", async () => {
    const { correr } = armar({ creador: null });

    assert.equal(await correr(SOLICITUD_ID), undefined);
  });

  it("no actua en rutas que no son de una solicitud", async () => {
    const { consultas, correr } = armar({ creador: "id-camejuca" });

    assert.equal(await correr("stats"), undefined);
    assert.deepEqual(consultas, { creador: 0, visibles: 0 });
  });
});
