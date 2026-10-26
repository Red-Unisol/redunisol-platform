/// <reference types="node" />
import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { recientesRefreshOptions } from "./recientes-refresh-options.ts";

// Transporte simulado; observadores, caché y conectividad reales de React Query.
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { addEventListener() {}, removeEventListener() {} },
});
const { QueryClient, QueryObserver, focusManager, onlineManager } =
  await import("@tanstack/react-query");
const clients: InstanceType<typeof QueryClient>[] = [];
function client() {
  const value = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
  });
  value.mount();
  clients.push(value);
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
  return value;
}
afterEach(() => {
  for (const value of clients.splice(0)) {
    value.unmount();
    value.clear();
  }
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
});
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await delay(5);
  }
  assert.ok(check(), "La consulta no alcanzó el estado esperado");
}

it("actualiza periódicamente, pausa al ocultarse/sin conexión y retoma al volver", async () => {
  const cache = client();
  let calls = 0;
  const observer = new QueryObserver(cache, {
    ...recientesRefreshOptions,
    // Reloj acelerado de prueba; producción permanece en 15 s.
    refetchInterval: 20,
    queryKey: ["recientes", "vendedores"],
    queryFn: async () => [++calls],
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await until(() => calls >= 2);
    focusManager.setFocused(false);
    const hiddenCalls = calls;
    await delay(65);
    assert.equal(calls, hiddenCalls);
    focusManager.setFocused(true);
    await until(() => calls > hiddenCalls);
    onlineManager.setOnline(false);
    const offlineCalls = calls;
    await delay(65);
    assert.equal(calls, offlineCalls);
    onlineManager.setOnline(true);
    await until(() => calls > offlineCalls);
  } finally {
    unsubscribe();
  }
});

it("deduplica la actualización del menú durante una consulta en curso", async () => {
  const cache = client();
  let calls = 0;
  let resolve!: (data: string[]) => void;
  const pending = new Promise<string[]>((done) => {
    resolve = done;
  });
  const observer = new QueryObserver(cache, {
    ...recientesRefreshOptions,
    refetchInterval: false,
    queryKey: ["recientes", "vendedores"],
    queryFn: () => {
      calls++;
      return pending;
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  const menu = cache.invalidateQueries(
    { queryKey: ["recientes"] },
    { cancelRefetch: false },
  );
  const manual = observer.refetch({ cancelRefetch: false });
  assert.equal(calls, 1);
  resolve(["solicitud"]);
  await Promise.all([menu, manual]);
  assert.deepEqual(observer.getCurrentResult().data, ["solicitud"]);
  unsubscribe();
});

it("un fallo conserva los registros y la fecha del último éxito", async () => {
  const cache = client();
  let fail = false;
  const observer = new QueryObserver(cache, {
    ...recientesRefreshOptions,
    refetchInterval: false,
    queryKey: ["recientes"],
    queryFn: async () => {
      if (fail) throw new Error("Sin servicio");
      return ["solicitud"];
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  await until(() => observer.getCurrentResult().isSuccess);
  const lastSuccess = observer.getCurrentResult().dataUpdatedAt;
  fail = true;
  await observer.refetch();
  assert.deepEqual(observer.getCurrentResult().data, ["solicitud"]);
  assert.equal(observer.getCurrentResult().dataUpdatedAt, lastSuccess);
  assert.equal(observer.getCurrentResult().isRefetchError, true);
  unsubscribe();
});

it("una respuesta atrasada de Vendedores no reemplaza Analistas", async () => {
  const cache = client();
  let finishOld!: (data: string[]) => void;
  const oldRequest = new Promise<string[]>((resolve) => {
    finishOld = resolve;
  });
  const observer = new QueryObserver(cache, {
    ...recientesRefreshOptions,
    refetchInterval: false,
    queryKey: ["recientes", "vendedores"],
    queryFn: () => oldRequest,
  });
  const unsubscribe = observer.subscribe(() => {});
  observer.setOptions({
    ...recientesRefreshOptions,
    refetchInterval: false,
    queryKey: ["recientes", "analistas"],
    queryFn: async () => ["riesgo"],
  });
  assert.equal(observer.getCurrentResult().data, undefined);
  await until(() => observer.getCurrentResult().isSuccess);
  finishOld(["vendedores"]);
  await delay(10);
  assert.deepEqual(observer.getCurrentResult().data, ["riesgo"]);
  unsubscribe();
});
