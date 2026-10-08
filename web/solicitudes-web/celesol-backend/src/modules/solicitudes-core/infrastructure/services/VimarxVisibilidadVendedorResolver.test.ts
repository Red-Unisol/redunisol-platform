import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VimarxVisibilidadVendedorResolver } from "./VimarxVisibilidadVendedorResolver";

type Pedido = { campos: string; cmd: string; tipo: string };

// Vimarx simulado: AMEJUCA (agente 15) es de nbrizuela y tiene tres vendedores.
function vimarx(opciones: { caido?: boolean } = {}) {
  const pedidos: Pedido[] = [];
  const fetcher = async (_url: string | URL, init?: RequestInit) => {
    const pedido = JSON.parse(String(init?.body)) as Pedido;
    pedidos.push(pedido);

    if (opciones.caido) {
      throw new Error("sin conexion");
    }

    let filas: unknown[] = [];

    if (pedido.tipo === "PreSolicitud.Module.AgenteSolicitud") {
      filas = pedido.cmd.includes("'nbrizuela'") ? [[15]] : [];
    }

    if (pedido.tipo === "PreSolicitud.Module.VendedorSolicitud") {
      filas = [["nbrizuela"], ["camejuca"], ["PCANO"]];
    }

    return { json: async () => filas, ok: true };
  };

  return { fetcher, pedidos };
}

// Usuarios de Sol Web por legacyUser (sin distinguir mayusculas).
const USUARIOS_SOL_WEB: Record<string, string> = {
  camejuca: "id-camejuca",
  nbrizuela: "id-nbrizuela",
  pcano: "id-pcano",
};

function armar(opciones: { caido?: boolean; reloj?: { ahora: number } } = {}) {
  const { fetcher, pedidos } = vimarx(opciones);
  const reloj = opciones.reloj ?? { ahora: 0 };
  const resolver = new VimarxVisibilidadVendedorResolver(
    { baseUrl: "https://vimarx.test", timeoutMs: 1000, ttlMs: 60_000 },
    {
      buscarIdsPorLegacyUsers: async (legacyUsers) =>
        legacyUsers
          .map((legacyUser) => USUARIOS_SOL_WEB[legacyUser.toLowerCase()])
          .filter((id): id is string => Boolean(id)),
      fetcher,
      now: () => reloj.ahora,
    },
  );

  return { pedidos, reloj, resolver };
}

describe("VimarxVisibilidadVendedorResolver", () => {
  it("al dueño de un agente le suma los vendedores de ese agente", async () => {
    const { pedidos, resolver } = armar();

    const creadores = await resolver.creadoresVisibles({
      id: "id-nbrizuela",
      legacyUser: "nbrizuela",
    });

    assert.deepEqual(creadores.sort(), [
      "id-camejuca",
      "id-nbrizuela",
      "id-pcano",
    ]);
    assert.equal(
      pedidos[1]?.cmd,
      "[Agente.ID] In (15) AND [Usuario] Is Not Null",
    );
  });

  it("a un vendedor que no es dueño le deja solo lo suyo", async () => {
    const { pedidos, resolver } = armar();

    const creadores = await resolver.creadoresVisibles({
      id: "id-pcano",
      legacyUser: "pcano",
    });

    assert.deepEqual(creadores, ["id-pcano"]);
    assert.equal(pedidos.length, 1);
  });

  it("con Vimarx caido deja solo lo suyo y reintenta en el pedido siguiente", async () => {
    const { pedidos, resolver } = armar({ caido: true });

    assert.deepEqual(
      await resolver.creadoresVisibles({ id: "id-nbrizuela", legacyUser: "nbrizuela" }),
      ["id-nbrizuela"],
    );
    await resolver.creadoresVisibles({ id: "id-nbrizuela", legacyUser: "nbrizuela" });

    assert.equal(pedidos.length, 2);
  });

  it("recuerda el resultado hasta que vence", async () => {
    const reloj = { ahora: 0 };
    const { pedidos, resolver } = armar({ reloj });
    const usuario = { id: "id-nbrizuela", legacyUser: "nbrizuela" };

    await resolver.creadoresVisibles(usuario);
    await resolver.creadoresVisibles(usuario);
    assert.equal(pedidos.length, 2);

    reloj.ahora = 60_001;
    await resolver.creadoresVisibles(usuario);
    assert.equal(pedidos.length, 4);
  });

  it("escapa el usuario dentro de la consulta a Vimarx", async () => {
    const { pedidos, resolver } = armar();

    await resolver.creadoresVisibles({ id: "id-x", legacyUser: "o'brien" });

    assert.equal(pedidos[0]?.cmd, "[Usuario.UserName] = 'o''brien'");
  });
});
