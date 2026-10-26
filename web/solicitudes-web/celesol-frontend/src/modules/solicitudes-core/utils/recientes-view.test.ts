/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initialRecientesView, recientesViews } from "./recientes-view.ts";
import { solicitudesCoreQueryKeys } from "../services/solicitudes-core-query-keys.ts";

function profile(code: string, isSystemAdmin = false) {
  return {
    isSystemAdmin,
    workflowOwnerId: code,
    workflowOwner: { id: code, code, name: code },
  };
}

describe("vistas Recientes", () => {
  it("Vendedores inicia en Vendedores, también para un perfil efectivo de impersonación", () => {
    const seller = profile("VENDEDORES");
    assert.equal(initialRecientesView(seller), "vendedores");
    assert.deepEqual(
      recientesViews(seller).map((x) => x.label),
      ["Vendedores", "Analistas", "Todas"],
    );
  });
  it("conserva las vistas de los demás perfiles", () => {
    assert.equal(initialRecientesView(profile("RIESGO")), "mi-area");
    assert.equal(initialRecientesView(profile("TESORERIA")), "todas");
    assert.equal(initialRecientesView(profile("VENDEDORES", true)), "todas");
    assert.equal(
      initialRecientesView({
        isSystemAdmin: false,
        workflowOwnerId: null,
        workflowOwner: null,
      }),
      "todas",
    );
    assert.deepEqual(
      recientesViews(profile("RIESGO")).map((x) => x.value),
      ["mi-area", "todas"],
    );
  });
  it("aísla caché por vista, usuario, área, búsqueda y paginación", () => {
    const base = {
      createdFrom: "2026-10-01",
      createdTo: "2026-10-21",
      limit: 10,
      offset: 0,
      userId: "seller",
      vista: "vendedores" as const,
    };
    const key = solicitudesCoreQueryKeys.recientes(base);
    for (const changes of [
      { vista: "analistas" as const },
      { vista: "todas" as const },
      { userId: "other" },
      { isSystemAdmin: true },
      { workflowOwnerId: "other" },
      { search: "Ana" },
      { offset: 10 },
    ]) {
      assert.notDeepEqual(
        solicitudesCoreQueryKeys.recientes({ ...base, ...changes }),
        key,
      );
    }
  });
});
