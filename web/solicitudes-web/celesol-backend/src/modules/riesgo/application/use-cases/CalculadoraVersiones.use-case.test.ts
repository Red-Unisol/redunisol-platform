import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import JSZip from "jszip";

import {
  CALCULADORA_VERSIONES_A_CONSERVAR,
  type CalculadoraRiesgoVersionConContenido,
  type CalculadoraRiesgoVersionRepository,
  type GuardarCalculadoraRiesgoVersionInput,
} from "../../domain/repositories/CalculadoraRiesgoVersionRepository";
import {
  CalculadoraCambioEnVimarxError,
  CalculadoraVersionNotFoundError,
  CalculadoraVersionYaVigenteError,
} from "../../domain/riesgo-errors";
import {
  compararCalculadoras,
  sinCambios,
} from "../services/CompararCalculadoras";
import { CalculadoraVersionesUseCase } from "./CalculadoraVersiones.use-case";

const FIXTURES = "src/modules/riesgo/infrastructure/services/fixtures";
const VIMARX = `${FIXTURES}/scoringpf-vimarx-2026-11-04.xlsx`;
const ESPERADA = `${FIXTURES}/scoringpf-adaptada-esperada.xlsx`;
const REPOSITORIO = "docs/calculadora-riesgo/CALCULADORA MUTUAL.xlsx";

/** Repositorio en memoria con la misma rotacion que el de Prisma. */
function repositorioEnMemoria(): CalculadoraRiesgoVersionRepository & {
  filas: CalculadoraRiesgoVersionConContenido[];
} {
  const filas: CalculadoraRiesgoVersionConContenido[] = [];
  let siguienteId = 1;
  const resumen = ({ contenido: _, ...resto }: CalculadoraRiesgoVersionConContenido) =>
    resto;

  return {
    filas,
    findById: async (id) => filas.find((f) => f.id === id) ?? null,
    findVigente: async () => filas.find((f) => f.vigente) ?? null,
    guardarComoVigente: async (input: GuardarCalculadoraRiesgoVersionInput) => {
      filas.forEach((f) => (f.vigente = false));
      const fila: CalculadoraRiesgoVersionConContenido = {
        cargadaEn: input.cargadaEn,
        cargadaPor: input.cargadaPorId
          ? { id: input.cargadaPorId, nombre: `Usuario ${input.cargadaPorId}` }
          : null,
        contenido: input.contenido,
        id: `00000000-0000-4000-8000-${String(siguienteId++).padStart(12, "0")}`,
        origen: input.origen,
        restauradaDeId: input.restauradaDeId,
        resumenCambios: input.resumenCambios,
        sha256: input.sha256,
        vigente: true,
      };
      filas.push(fila);
      filas.sort((a, b) => b.cargadaEn.getTime() - a.cargadaEn.getTime());
      filas.splice(CALCULADORA_VERSIONES_A_CONSERVAR);
      return resumen(fila);
    },
    listar: async () => filas.map(resumen),
  };
}

async function armar(opciones: { vimarx?: Buffer } = {}) {
  const repository = repositorioEnMemoria();
  let reloj = Date.parse("2026-11-17T12:00:00.000Z");
  const planillas = { vimarx: opciones.vimarx ?? (await readFile(VIMARX)) };
  const useCase = new CalculadoraVersionesUseCase({
    leerPlanillaRepositorio: () => readFile(REPOSITORIO),
    now: () => new Date((reloj += 60_000)),
    repository,
    vimarx: { descargar: async () => planillas.vimarx },
  });
  return { planillas, repository, useCase };
}

describe("CalculadoraVersionesUseCase", () => {
  it("la vista previa muestra los cambios de la planilla de Vimarx sin guardar nada", async () => {
    const { repository, useCase } = await armar();

    const vistaPrevia = await useCase.previsualizar();

    assert.equal(vistaPrevia.sinCambios, false);
    assert.match(vistaPrevia.huellaVimarx, /^[0-9a-f]{64}$/);
    assert.deepEqual(
      vistaPrevia.cambios.hojas.map((h) => h.hoja),
      ["CRUZ DE EJE"],
    );
    const cruzDeEje = vistaPrevia.cambios.hojas[0];
    assert.equal(cruzDeEje.total, 35);
    assert.deepEqual(cruzDeEje.celdas[0], {
      antes: "",
      despues: "4457.8",
      ref: "D11",
    });
    assert.ok(
      cruzDeEje.celdas.some(
        (c) => c.ref === "C26" && c.despues === "Cuota social CDE",
      ),
    );
    assert.equal(repository.filas.length, 0);
  });

  it("al aplicar guarda la del repo como inicial y deja vigente la de Vimarx", async () => {
    const { repository, useCase } = await armar();
    const { huellaVimarx } = await useCase.previsualizar();

    const version = await useCase.aplicar({ huellaVimarx, usuarioId: "riesgo-1" });

    assert.equal(version?.origen, "VIMARX");
    assert.equal(version?.cargadaPor?.id, "riesgo-1");
    assert.deepEqual(
      repository.filas.map((f) => [f.origen, f.vigente]),
      [
        ["VIMARX", true],
        ["REPOSITORIO", false],
      ],
    );
    assert.deepEqual(repository.filas[1].contenido, await readFile(REPOSITORIO));
    // Lo que queda vigente es lo mismo que produce el script de Python.
    const vigente = await repository.findVigente();
    const esperada = await readFile(ESPERADA);
    assert.ok(sinCambios(await compararCalculadoras(esperada, vigente!.contenido)));
  });

  it("no aplica si la planilla cambió en Vimarx después de la vista previa", async () => {
    const { planillas, repository, useCase } = await armar();
    const { huellaVimarx } = await useCase.previsualizar();
    // Riesgo vuelve a tocar la planilla en Vimarx (otra celda de CRUZ DE EJE).
    const zip = await JSZip.loadAsync(planillas.vimarx);
    const hoja = "xl/worksheets/sheet5.xml";
    const xml = await zip.file(hoja)!.async("string");
    zip.file(hoja, xml.replace("<v>4457.8000000000002</v>", "<v>1</v>"));
    planillas.vimarx = await zip.generateAsync({ type: "nodebuffer" });

    await assert.rejects(
      () => useCase.aplicar({ huellaVimarx, usuarioId: "riesgo-1" }),
      CalculadoraCambioEnVimarxError,
    );
    assert.equal(repository.filas.length, 0);
  });

  it("si Vimarx no cambió desde la vigente, no crea otra versión", async () => {
    const { repository, useCase } = await armar();
    const primera = await useCase.previsualizar();
    await useCase.aplicar({ huellaVimarx: primera.huellaVimarx, usuarioId: "riesgo-1" });

    const segunda = await useCase.previsualizar();
    const version = await useCase.aplicar({
      huellaVimarx: segunda.huellaVimarx,
      usuarioId: "riesgo-2",
    });

    assert.equal(segunda.sinCambios, true);
    assert.equal(version, null);
    assert.equal(repository.filas.length, 2);
  });

  it("volver atrás crea una copia vigente que dice de cuál viene", async () => {
    const { repository, useCase } = await armar();
    const { huellaVimarx } = await useCase.previsualizar();
    await useCase.aplicar({ huellaVimarx, usuarioId: "riesgo-1" });
    const inicial = repository.filas.find((f) => f.origen === "REPOSITORIO")!;

    const version = await useCase.restaurar({
      usuarioId: "riesgo-2",
      versionId: inicial.id,
    });

    assert.equal(version.origen, "RESTAURADA");
    assert.equal(version.restauradaDeId, inicial.id);
    assert.deepEqual(version.resumenCambios, {
      restauradaDe: {
        cargadaEn: inicial.cargadaEn.toISOString(),
        cargadaPor: null,
        origen: "REPOSITORIO",
      },
    });
    assert.deepEqual((await repository.findVigente())!.contenido, inicial.contenido);
    assert.equal(repository.filas.length, 3);
  });

  it("no vuelve a una versión que no existe o que ya es la vigente", async () => {
    const { repository, useCase } = await armar();
    const { huellaVimarx } = await useCase.previsualizar();
    await useCase.aplicar({ huellaVimarx, usuarioId: "riesgo-1" });
    const vigente = repository.filas.find((f) => f.vigente)!;

    await assert.rejects(
      () => useCase.restaurar({ usuarioId: "riesgo-1", versionId: "no-existe" }),
      CalculadoraVersionNotFoundError,
    );
    await assert.rejects(
      () => useCase.restaurar({ usuarioId: "riesgo-1", versionId: vigente.id }),
      CalculadoraVersionYaVigenteError,
    );
  });

  it("conserva la vigente y las 3 anteriores", async () => {
    const { repository, useCase } = await armar();
    const { huellaVimarx } = await useCase.previsualizar();
    await useCase.aplicar({ huellaVimarx, usuarioId: "riesgo-1" });

    for (let vez = 0; vez < 4; vez += 1) {
      const anterior = repository.filas.find((f) => !f.vigente)!;
      await useCase.restaurar({ usuarioId: "riesgo-1", versionId: anterior.id });
    }

    assert.equal(repository.filas.length, CALCULADORA_VERSIONES_A_CONSERVAR);
    assert.equal(repository.filas.filter((f) => f.vigente).length, 1);
  });
});
