/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  recientesRefreshLabel,
  recientesRefreshOptions,
} from "./recientes-refresh-options.ts";

describe("indicador Recientes", () => {
  const base = {
    now: 10_000,
    dataUpdatedAt: 2_000,
    isFetching: false,
    isError: false,
    isPaused: false,
  };
  it("mide desde el último éxito y no presenta un intento fallido como actualizado", () => {
    assert.equal(recientesRefreshLabel(base), "Actualizado hace 8 segundos");
    assert.equal(
      recientesRefreshLabel({ ...base, isFetching: true }),
      "Actualizando…",
    );
    assert.equal(
      recientesRefreshLabel({ ...base, isError: true }),
      "No se pudo actualizar",
    );
    assert.equal(
      recientesRefreshLabel({ ...base, dataUpdatedAt: 0 }),
      "Sin actualizar",
    );
    assert.equal(
      recientesRefreshLabel({ ...base, isPaused: true }),
      "Sin conexión",
    );
    assert.equal(
      recientesRefreshLabel({ ...base, now: 3_000 }),
      "Actualizado hace 1 segundo",
    );
  });
  it("usa 15 segundos sin intervalos en segundo plano ni reintentos en bucle", () => {
    assert.equal(recientesRefreshOptions.refetchInterval, 15_000);
    assert.equal(recientesRefreshOptions.refetchIntervalInBackground, false);
    assert.equal(recientesRefreshOptions.networkMode, "online");
    assert.equal(recientesRefreshOptions.retry, false);
  });
});
