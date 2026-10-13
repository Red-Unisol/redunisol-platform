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
