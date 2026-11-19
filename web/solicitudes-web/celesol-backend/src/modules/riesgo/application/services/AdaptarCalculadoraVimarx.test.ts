import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import JSZip from "jszip";

import { CalculadoraNoAdaptableError } from "../../domain/riesgo-errors";
import { adaptarCalculadoraVimarx } from "./AdaptarCalculadoraVimarx";

const FIXTURES = "src/modules/riesgo/infrastructure/services/fixtures";
// SCORINGPF tal como estaba en Vimarx el 4/11/2026, y lo que produjo con ella
// scripts/actualizar_calculadora_riesgo.py (la planilla del PR #745).
const VIMARX = `${FIXTURES}/scoringpf-vimarx-2026-11-04.xlsx`;
const ESPERADA = `${FIXTURES}/scoringpf-adaptada-esperada.xlsx`;
const ACTUAL = "docs/calculadora-riesgo/CALCULADORA MUTUAL.xlsx";
// En SCORINGPF la hoja Datos es sheet11.
const HOJA_DATOS = "xl/worksheets/sheet11.xml";

async function contenidoPorArchivo(xlsx: Buffer) {
  const zip = await JSZip.loadAsync(xlsx);
  const archivos = new Map<string, string>();
  for (const nombre of Object.keys(zip.files)) {
    if (!zip.files[nombre].dir) {
      archivos.set(nombre, await zip.files[nombre].async("base64"));
    }
  }
  return archivos;
}

async function conHojaDatosModificada(
  xlsx: Buffer,
  cambiar: (xml: string) => string,
) {
  const zip = await JSZip.loadAsync(xlsx);
  const xml = await zip.file(HOJA_DATOS)!.async("string");
  const cambiado = cambiar(xml);
  assert.notEqual(cambiado, xml, "el cambio de prueba no modificó la hoja");
  zip.file(HOJA_DATOS, cambiado);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("adaptarCalculadoraVimarx", () => {
  it("produce lo mismo que el script de Python", async () => {
    const { contenido, resumen } = await adaptarCalculadoraVimarx(
      await readFile(VIMARX),
      await readFile(ACTUAL),
    );

    assert.deepEqual(resumen, {
      celdasVimarxAdaptadas: 58,
      numerosConComaConvertidos: 3,
    });
    const obtenida = await contenidoPorArchivo(contenido);
    const esperada = await contenidoPorArchivo(await readFile(ESPERADA));
    assert.deepEqual([...obtenida.keys()], [...esperada.keys()]);
    for (const [nombre, datos] of esperada) {
      assert.equal(obtenida.get(nombre), datos, `${nombre} es distinto`);
    }
  });

  it("toma la hoja Datos de la planilla actual aunque sea otra versión", async () => {
    // Adaptar contra la planilla ya adaptada da el mismo resultado.
    const esperada = await readFile(ESPERADA);
    const { contenido } = await adaptarCalculadoraVimarx(
      await readFile(VIMARX),
      esperada,
    );

    assert.deepEqual(
      await contenidoPorArchivo(contenido),
      await contenidoPorArchivo(esperada),
    );
  });

  it("frena si en Datos cambió una celda que no llama a Vimarx", async () => {
    const vimarx = await conHojaDatosModificada(
      await readFile(VIMARX),
      // A1 es un titulo de la hoja, no una llamada a Vimarx.
      (xml) =>
        xml.replace(
          /<c r="A1"([^>]*)>[\s\S]*?<\/c>/,
          '<c r="A1" s="277" t="inlineStr"><is><t>Otro titulo</t></is></c>',
        ),
    );

    await assert.rejects(
      async () =>
        adaptarCalculadoraVimarx(vimarx, await readFile(ACTUAL)),
      (error: unknown) =>
        error instanceof CalculadoraNoAdaptableError &&
        /cambiaron celdas que no son llamadas a Vimarx: A1\./.test(error.message),
    );
  });

  it("frena si la planilla no trae fórmulas de Vimarx", async () => {
    // La ya adaptada no tiene EVALUARXP: no es una SCORINGPF.
    await assert.rejects(
      async () =>
        adaptarCalculadoraVimarx(
          await readFile(ESPERADA),
          await readFile(ACTUAL),
        ),
      (error: unknown) =>
        error instanceof CalculadoraNoAdaptableError &&
        /No se encontraron fórmulas de Vimarx/.test(error.message),
    );
  });

  it("frena si no es un Excel", async () => {
    await assert.rejects(
      async () =>
        adaptarCalculadoraVimarx(Buffer.from("no es excel"), await readFile(ACTUAL)),
      CalculadoraNoAdaptableError,
    );
  });
});
