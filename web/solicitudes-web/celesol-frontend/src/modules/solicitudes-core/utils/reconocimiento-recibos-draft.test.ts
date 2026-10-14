import assert from "node:assert/strict";
import { it } from "node:test";
import { ReconocimientoRecibosDraft } from "./reconocimiento-recibos-draft";
const file = {} as File;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup() {
  let config = { habilitado: true, version: 1 };
  let detections = 0;
  let calls = 0;
  const pending = deferred<{ resultado: "recibo"; version: number }>();
  const statuses: string[] = [];
  const draft = new ReconocimientoRecibosDraft(
    {
      config: async () => config,
      analyze: async () => {
        calls++;
        return pending.promise;
      },
    },
    (_id, state) => statuses.push(state),
  );
  return {
    draft,
    pending,
    statuses,
    change: (c: typeof config) => {
      config = c;
    },
    detect: () => {
      detections++;
    },
    counts: () => ({ detections, calls }),
  };
}
it("disabled setting makes no recognition call", async () => {
  const s = setup();
  s.change({ habilitado: false, version: 1 });
  s.draft.start("one", file, s.detect);
  await flush();
  assert.deepEqual(s.counts(), { calls: 0, detections: 0 });
});
it("only active file receives a positive result", async () => {
  const s = setup();
  s.draft.start("one", file, s.detect);
  await flush();
  s.pending.resolve({ resultado: "recibo", version: 1 });
  await flush();
  assert.equal(s.counts().detections, 1);
  assert.equal(s.statuses.at(-1), "recibo");
});
for (const action of [
  "manual",
  "removed",
  "closed",
  "saved",
  "contextChanged",
] as const)
  it(`late result cannot override ${action}`, async () => {
    const s = setup();
    s.draft.start("one", file, s.detect);
    await flush();
    if (action === "manual") s.draft.manual("one");
    else if (action === "removed") s.draft.cancel("one");
    else s.draft.cancelAll();
    s.pending.resolve({ resultado: "recibo", version: 1 });
    await flush();
    assert.equal(s.counts().detections, 0);
  });
it("disabling then reactivating still discards old results", async () => {
  const s = setup();
  s.draft.start("one", file, s.detect);
  await flush();
  s.change({ habilitado: true, version: 3 });
  s.pending.resolve({ resultado: "recibo", version: 1 });
  await flush();
  assert.equal(s.counts().detections, 0);
});
it("polling stops pending recognition after disabling", async () => {
  const s = setup();
  s.draft.start("one", file, s.detect);
  await flush();
  s.change({ habilitado: false, version: 2 });
  await s.draft.refreshConfig();
  s.pending.resolve({ resultado: "recibo", version: 1 });
  await flush();
  assert.equal(s.counts().detections, 0);
  assert.equal(s.statuses.at(-1), "deshabilitado");
});
it("replaced file cannot populate the new file", async () => {
  const first = deferred<{ resultado: "recibo"; version: number }>();
  const second = deferred<{ resultado: "indeterminado"; version: number }>();
  let calls = 0;
  let detected = 0;
  const draft = new ReconocimientoRecibosDraft(
    {
      config: async () => ({ habilitado: true, version: 1 }),
      analyze: async () => (++calls === 1 ? first.promise : second.promise),
    },
    () => {},
  );
  draft.start("one", file, () => {
    detected++;
  });
  await flush();
  draft.start("one", file, () => {
    detected++;
  });
  await flush();
  first.resolve({ resultado: "recibo", version: 1 });
  second.resolve({ resultado: "indeterminado", version: 1 });
  await flush();
  assert.equal(detected, 0);
});

for (const nextId of ["one", "two"])
  it(`late polling does not cancel a new analysis with id ${nextId}`, async () => {
    let config = { habilitado: true, version: 1 };
    const pollConfig = deferred<typeof config>();
    const oldResult = deferred<{ resultado: "recibo"; version: number }>();
    const newResult = deferred<{ resultado: "recibo"; version: number }>();
    const signals: AbortSignal[] = [];
    const detections: string[] = [];
    let configReads = 0;
    const draft = new ReconocimientoRecibosDraft(
      {
        config: async () =>
          ++configReads === 2 ? pollConfig.promise : { ...config },
        analyze: async (_file, signal) => {
          signals.push(signal);
          return signals.length === 1 ? oldResult.promise : newResult.promise;
        },
      },
      () => {},
    );
    draft.start("one", file, () => detections.push("old"));
    await flush();
    const poll = draft.refreshConfig();
    config = { habilitado: true, version: 3 };
    draft.start(nextId, file, () => detections.push("new"));
    await flush();
    pollConfig.resolve({ habilitado: false, version: 2 });
    await poll;
    assert.equal(signals[0].aborted, true);
    assert.equal(signals[1].aborted, false);
    oldResult.resolve({ resultado: "recibo", version: 1 });
    newResult.resolve({ resultado: "recibo", version: 3 });
    await flush();
    assert.deepEqual(detections, ["new"]);
  });

for (const habilitado of [false, true])
  it(`polling ignores an older configuration with habilitado=${habilitado}`, async () => {
    const initialConfig = deferred<{ habilitado: boolean; version: number }>();
    const pollConfig = deferred<{ habilitado: boolean; version: number }>();
    const result = deferred<{ resultado: "recibo"; version: number }>();
    let configReads = 0;
    let signal!: AbortSignal;
    let detections = 0;
    const draft = new ReconocimientoRecibosDraft(
      {
        config: async () => {
          if (++configReads === 1) return initialConfig.promise;
          if (configReads === 2) return pollConfig.promise;
          return { habilitado: true, version: 3 };
        },
        analyze: async (_file, receivedSignal) => {
          signal = receivedSignal;
          return result.promise;
        },
      },
      () => {},
    );
    draft.start("one", file, () => detections++);
    const poll = draft.refreshConfig();
    initialConfig.resolve({ habilitado: true, version: 3 });
    await flush();
    pollConfig.resolve({ habilitado, version: 2 });
    await poll;
    assert.equal(signal.aborted, false);
    result.resolve({ resultado: "recibo", version: 3 });
    await flush();
    assert.equal(detections, 1);
  });

it("polling leaves initial configuration validation to the pending job", async () => {
  const initialConfig = deferred<{ habilitado: boolean; version: number }>();
  const result = deferred<{ resultado: "recibo"; version: number }>();
  let configReads = 0;
  let calls = 0;
  let detections = 0;
  const draft = new ReconocimientoRecibosDraft(
    {
      config: async () => {
        if (++configReads === 1) return initialConfig.promise;
        if (configReads === 2) return { habilitado: false, version: 2 };
        return { habilitado: true, version: 3 };
      },
      analyze: async () => {
        calls++;
        return result.promise;
      },
    },
    () => {},
  );
  draft.start("one", file, () => detections++);
  await draft.refreshConfig();
  initialConfig.resolve({ habilitado: true, version: 3 });
  await flush();
  assert.equal(calls, 1);
  result.resolve({ resultado: "recibo", version: 3 });
  await flush();
  assert.equal(detections, 1);
});

it("polling still cancels a job after disabling and reactivating", async () => {
  const s = setup();
  s.draft.start("one", file, s.detect);
  await flush();
  s.change({ habilitado: true, version: 3 });
  await s.draft.refreshConfig();
  s.pending.resolve({ resultado: "recibo", version: 1 });
  await flush();
  assert.equal(s.counts().detections, 0);
  assert.equal(s.statuses.at(-1), "deshabilitado");
});
