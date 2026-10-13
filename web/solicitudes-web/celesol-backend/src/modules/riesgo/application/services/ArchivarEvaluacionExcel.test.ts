import assert from "node:assert/strict";
import { it } from "node:test";
import { Readable } from "node:stream";
import type { SolicitudAdjunto } from "../../../solicitudes-core/adjuntos/domain/entities/SolicitudAdjunto.entity";
import { storedAdjunto } from "../../../solicitudes-core/adjuntos/application/use-cases/AdjuntosUseCaseTest.fixtures";
import { EvaluacionArchivoUnavailableError } from "../../domain/riesgo-errors";
import { ArchivarEvaluacionExcel } from "./ArchivarEvaluacionExcel";

function setup() {
  const records = new Map<string, SolicitudAdjunto>();
  let snapshot = {
    sheets: { s: { name: "Evaluacion", cellData: { 0: { 0: { v: 123 } } } } },
  };
  let exists = true;
  let fail = false;
  const uploads: Buffer[] = [];
  const service = new ArchivarEvaluacionExcel({
    bucket: "adjuntos",
    evaluaciones: {
      findBySolicitudId: async () =>
        exists
          ? {
              guardadaEn: new Date("2026-10-13T10:00:00Z"),
              guardadaPor: { id: "analista", nombre: "Ana" },
              nivelRiesgo: 3,
              storageBucket: "evaluaciones",
              storageKey: "snapshot.json",
            }
          : null,
    },
    storage: {
      getObjectStream: async () => Readable.from([JSON.stringify(snapshot)]),
      uploadObject: async ({ body }) => {
        if (fail) throw new Error("storage unavailable");
        uploads.push(body);
      },
    },
    exportar: async (received) => {
      assert.deepEqual(received, snapshot);
      return Buffer.from("Excel de la evaluación guardada");
    },
    adjuntos: {
      findById: async (id) => records.get(id) ?? null,
      create: async (record) => {
        if (records.has(record.adjuntoId)) throw new Error("unique");
        const result = storedAdjunto({ ...record, id: record.adjuntoId });
        records.set(result.id, result);
        return result;
      },
    },
  });
  return {
    service,
    records,
    uploads,
    change: () => {
      snapshot = {
        sheets: {
          s: { name: "Evaluacion", cellData: { 0: { 0: { v: 456 } } } },
        },
      };
    },
    missing: () => {
      exists = false;
    },
    fail: () => {
      fail = true;
    },
  };
}
const input = {
  solicitudId: "sol-1",
  actorId: "operador",
  etapa: "generacion" as const,
};
it("adjunta la copia guardada, atribuye la carga al actor y evita duplicados en reintentos y liquidación", async () => {
  const s = setup();
  await s.service.execute(input);
  await s.service.execute(input);
  await s.service.execute({ ...input, etapa: "liquidacion" });
  assert.equal(s.records.size, 1);
  assert.equal(s.uploads.length, 1);
  const file = [...s.records.values()][0];
  assert.equal(file.solicitudId, "sol-1");
  assert.equal(file.uploadedBy, "operador");
  assert.equal(file.tipoAdjunto, "Documentación Adicional");
  assert.ok(file.archivoNombre?.endsWith(".xlsx"));
  assert.ok(file.comentario?.includes("Ana"));
});
it("conserva generación y agrega la nueva evaluación guardada al liquidar", async () => {
  const s = setup();
  await s.service.execute(input);
  s.change();
  await s.service.execute({ ...input, etapa: "liquidacion" });
  assert.equal(s.records.size, 2);
  assert.equal(s.uploads.length, 2);
  assert.ok(
    [...s.records.values()].some((f) =>
      f.archivoNombre?.startsWith("Evaluacion-liquidacion"),
    ),
  );
});
it("no mezcla copias entre solicitudes", async () => {
  const s = setup();
  await s.service.execute(input);
  await s.service.execute({ ...input, solicitudId: "sol-2" });
  assert.equal(s.records.size, 2);
});
it("sin evaluación no inventa un Excel ni una nueva obligación", async () => {
  const s = setup();
  s.missing();
  await s.service.execute(input);
  assert.equal(s.records.size, 0);
  assert.equal(s.uploads.length, 0);
});
it("fallos de almacenamiento no registran adjuntos incompletos", async () => {
  const s = setup();
  s.fail();
  await assert.rejects(
    () => s.service.execute(input),
    EvaluacionArchivoUnavailableError,
  );
  assert.equal(s.records.size, 0);
});
it("dos cargas concurrentes registran una sola copia", async () => {
  const s = setup();
  await Promise.all([s.service.execute(input), s.service.execute(input)]);
  assert.equal(s.records.size, 1);
});
