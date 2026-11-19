import type JSZip from "jszip";

import { abrir, celdas, leer, textosCompartidos } from "./AdaptarCalculadoraVimarx";

/** Cuantas celdas por hoja se muestran en la vista previa. */
const CELDAS_POR_HOJA = 30;

export type CambioDeCelda = { antes: string; despues: string; ref: string };

export type CambiosCalculadora = {
  hojas: Array<{ celdas: CambioDeCelda[]; hoja: string; total: number }>;
  hojasNuevas: string[];
  hojasQuitadas: string[];
};

/**
 * Que cambio entre dos planillas, celda por celda: la formula si hay, si no el
 * valor. Es lo que Riesgo ve antes de aplicar una version nueva.
 */
export async function compararCalculadoras(
  anterior: Buffer,
  nueva: Buffer,
): Promise<CambiosCalculadora> {
  const hojasAnterior = await celdasPorHoja(anterior);
  const hojasNueva = await celdasPorHoja(nueva);
  const cambios: CambiosCalculadora = {
    hojas: [],
    hojasNuevas: [...hojasNueva.keys()].filter((h) => !hojasAnterior.has(h)),
    hojasQuitadas: [...hojasAnterior.keys()].filter((h) => !hojasNueva.has(h)),
  };

  for (const [hoja, celdasNueva] of hojasNueva) {
    const celdasAnterior = hojasAnterior.get(hoja);
    if (!celdasAnterior) {
      continue;
    }
    const distintas = [...new Set([...celdasAnterior.keys(), ...celdasNueva.keys()])]
      .map((ref) => ({
        antes: celdasAnterior.get(ref) ?? "",
        despues: celdasNueva.get(ref) ?? "",
        ref,
      }))
      .filter((cambio) => cambio.antes !== cambio.despues)
      .sort((a, b) => compararRefs(a.ref, b.ref));

    if (distintas.length > 0) {
      cambios.hojas.push({
        celdas: distintas.slice(0, CELDAS_POR_HOJA),
        hoja,
        total: distintas.length,
      });
    }
  }

  return cambios;
}

export function sinCambios(cambios: CambiosCalculadora) {
  return (
    cambios.hojas.length === 0 &&
    cambios.hojasNuevas.length === 0 &&
    cambios.hojasQuitadas.length === 0
  );
}

/** {hoja: {ref: formula o valor}}, en el orden del libro. */
async function celdasPorHoja(xlsx: Buffer) {
  const zip = await abrir(xlsx, "la planilla");
  const compartidos = await textosCompartidos(zip);
  const resultado = new Map<string, Map<string, string>>();

  for (const [nombre, ruta] of await rutasDeHojas(zip)) {
    const xml = await leer(zip, ruta);
    const porRef = new Map<string, string>();
    for (const [ref, celda] of celdas(xml, compartidos)) {
      if (celda.comparable !== "") {
        porRef.set(ref, legible(celda.comparable));
      }
    }
    resultado.set(decodificarXml(nombre), porRef);
  }

  return resultado;
}

async function rutasDeHojas(zip: JSZip) {
  const libro = await leer(zip, "xl/workbook.xml");
  const relaciones = await leer(zip, "xl/_rels/workbook.xml.rels");
  const destinos = new Map(
    [...relaciones.matchAll(/<Relationship\b[^>]*\/>/g)].flatMap(([rel]) => {
      const id = /\bId="([^"]+)"/.exec(rel)?.[1];
      const destino = /\bTarget="([^"]+)"/.exec(rel)?.[1];
      return id && destino ? [[id, destino] as const] : [];
    }),
  );

  return [...libro.matchAll(/<sheet\b[^>]*\/>/g)].flatMap(([hoja]) => {
    const nombre = /\bname="([^"]*)"/.exec(hoja)?.[1];
    const destino = destinos.get(/\br:id="([^"]+)"/.exec(hoja)?.[1] ?? "");
    if (nombre === undefined || !destino) {
      return [];
    }
    const ruta = destino.startsWith("/xl/") ? destino.slice(1) : `xl/${destino}`;
    return [[nombre, ruta] as const];
  });
}

/** A1 < B1 < A2: por fila y despues por columna. */
function compararRefs(a: string, b: string) {
  const [, colA = "", filaA = "0"] = /^([A-Z]+)(\d+)$/.exec(a) ?? [];
  const [, colB = "", filaB = "0"] = /^([A-Z]+)(\d+)$/.exec(b) ?? [];
  return (
    Number(filaA) - Number(filaB) ||
    colA.length - colB.length ||
    colA.localeCompare(colB)
  );
}

/** Excel guarda 4457.8 como 4457.8000000000002: se muestra como 4457.8. */
function legible(valor: string) {
  if (/^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(valor)) {
    return String(Number(valor));
  }
  return decodificarXml(valor);
}

function decodificarXml(texto: string) {
  return texto
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, codigo: string) => String.fromCodePoint(Number(codigo)))
    .replace(/&amp;/g, "&");
}
