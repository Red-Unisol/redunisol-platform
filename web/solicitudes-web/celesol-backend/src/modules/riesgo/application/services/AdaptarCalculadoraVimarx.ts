import JSZip from "jszip";

import { CalculadoraNoAdaptableError } from "../../domain/riesgo-errors";

/**
 * Adapta la planilla SCORINGPF de Vimarx para la calculadora de Sol Web.
 * Es el mismo proceso que scripts/actualizar_calculadora_riesgo.py:
 *
 * - La hoja "Datos" lee la solicitud con EVALUARXP y graba con STOREXP,
 *   funciones propias de Vimarx. Sol Web completa esa hoja desde la solicitud,
 *   asi que esas celdas se toman de la planilla que ya usa Sol Web. Si en
 *   "Datos" cambio algo que no es una llamada a Vimarx, no se adapta: hay que
 *   hacerlo a mano.
 * - Excel en espanol toma el texto "0,5" como numero y la planilla del
 *   navegador no: los numeros con coma escritos como texto dentro de una
 *   formula pasan a numero.
 *
 * Se trabaja sobre el XML del .xlsx para no perder estilos ni imagenes.
 */

const HOJA_DATOS = "Datos";

const FUNCIONES_VIMARX = /EVALUARXP|STOREXP/;
const CELDA_VACIA = /<c\b([^>/]*)\/>/g;
const REF = /\br="([A-Z]+[0-9]+)"/;
const TIPO = /\s*\bt="[^"]*"/g;
const TIPO_UNO = /\bt="[^"]*"/;
const TEXTOS_COMPARTIDOS = /<si>([\s\S]*?)<\/si>/g;
const TEXTO = /<t\b[^>]*>([\s\S]*?)<\/t>/;
const TEXTO_TODOS = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
// Sin "/" en los atributos: una celda vacia (<c r="A1"/>) no debe tomarse
// como apertura y unirse con la celda siguiente.
const CELDA = /<c\b([^>/]*)>([\s\S]*?)<\/c>/g;
const FORMULA = /<f\b[^>]*?(?:\/>|>([\s\S]*?)<\/f>)/;
const FORMULA_TODAS = /<f\b[^>]*?(?:\/>|>([\s\S]*?)<\/f>)/g;
const VALOR = /<v>([\s\S]*?)<\/v>/;
const GRUPO = /<f\b[^>]*\bt="shared"[^>]*\bsi="(\d+)"/;
const FORMULA_MADRE =
  /<f\b[^>]*\bt="shared"[^>]*\bsi="(\d+)"[^>/]*>([\s\S]*?)<\/f>/g;
const NUMERO_CON_COMA = /(?:"|&quot;)(-?\d+),(\d+)(?:"|&quot;)/g;

export type ResumenAdaptacion = {
  celdasVimarxAdaptadas: number;
  numerosConComaConvertidos: number;
};

type Celda = { atributos: string; comparable: string; contenido: string };

/**
 * @param xlsxVimarx la planilla tal como esta en Vimarx.
 * @param xlsxActual la planilla que usa hoy Sol Web: de ahi sale la hoja
 *   "Datos" ya adaptada.
 */
export async function adaptarCalculadoraVimarx(
  xlsxVimarx: Buffer,
  xlsxActual: Buffer,
): Promise<{ contenido: Buffer; resumen: ResumenAdaptacion }> {
  const entrada = await abrir(xlsxVimarx, "la planilla de Vimarx");
  const actual = await abrir(xlsxActual, "la planilla actual");
  const hojaDatos = await rutaDeHoja(entrada, HOJA_DATOS);
  const compartidos = await textosCompartidos(entrada);
  const xmlDatosActual = await leer(actual, await rutaDeHoja(actual, HOJA_DATOS));
  const compartidosActual = await textosCompartidos(actual);
  const resumen: ResumenAdaptacion = {
    celdasVimarxAdaptadas: 0,
    numerosConComaConvertidos: 0,
  };

  for (const nombre of Object.keys(entrada.files)) {
    if (!nombre.startsWith("xl/worksheets/sheet") || entrada.files[nombre].dir) {
      continue;
    }

    let xml = await leer(entrada, nombre);

    if (nombre === hojaDatos) {
      const adaptada = adaptarDatos(
        xml,
        compartidos,
        xmlDatosActual,
        compartidosActual,
      );
      xml = adaptada.xml;
      resumen.celdasVimarxAdaptadas += adaptada.adaptadas;
    }

    const conNumeros = numerosConComaANumero(xml);
    xml = conNumeros.xml;
    resumen.numerosConComaConvertidos += conNumeros.convertidos;

    const formulas = [...xml.matchAll(FORMULA_TODAS)].map((m) => m[0]).join("");
    if (FUNCIONES_VIMARX.test(formulas)) {
      throw new CalculadoraNoAdaptableError(
        `Quedaron fórmulas de Vimarx en ${nombre}: solo se adaptan las de la hoja ${HOJA_DATOS}.`,
      );
    }

    entrada.file(nombre, xml);
  }

  if (resumen.celdasVimarxAdaptadas === 0) {
    throw new CalculadoraNoAdaptableError(
      `No se encontraron fórmulas de Vimarx en ${HOJA_DATOS}: la planilla no es la esperada.`,
    );
  }

  const contenido = await entrada.generateAsync({
    compression: "DEFLATE",
    type: "nodebuffer",
  });

  return { contenido, resumen };
}

export async function abrir(xlsx: Buffer, descripcion: string) {
  try {
    return await JSZip.loadAsync(xlsx);
  } catch {
    throw new CalculadoraNoAdaptableError(
      `No se pudo abrir ${descripcion}: no es un archivo de Excel válido.`,
    );
  }
}

export async function leer(zip: JSZip, nombre: string) {
  const archivo = zip.file(nombre);
  if (!archivo) {
    throw new CalculadoraNoAdaptableError(`Falta ${nombre} en la planilla.`);
  }
  return archivo.async("string");
}

async function rutaDeHoja(zip: JSZip, nombre: string) {
  const libro = await leer(zip, "xl/workbook.xml");
  const relaciones = await leer(zip, "xl/_rels/workbook.xml.rels");
  const hoja = new RegExp(
    `<sheet\\b[^>]*name="${escaparRegex(nombre)}"[^>]*/>`,
  ).exec(libro);
  if (!hoja) {
    throw new CalculadoraNoAdaptableError(
      `La planilla no tiene la hoja "${nombre}".`,
    );
  }
  const rid = /r:id="([^"]+)"/.exec(hoja[0])?.[1];
  const relacion = rid
    ? new RegExp(`<Relationship\\b[^>]*Id="${escaparRegex(rid)}"[^>]*/>`).exec(
        relaciones,
      )
    : null;
  const destino = relacion ? /Target="([^"]+)"/.exec(relacion[0])?.[1] : null;
  if (!destino) {
    throw new CalculadoraNoAdaptableError(
      `No se encontró el archivo de la hoja "${nombre}".`,
    );
  }
  return destino.startsWith("/xl/") ? destino.slice(1) : `xl/${destino}`;
}

export async function textosCompartidos(zip: JSZip) {
  if (!zip.file("xl/sharedStrings.xml")) {
    return [];
  }
  const xml = await leer(zip, "xl/sharedStrings.xml");
  return [...xml.matchAll(TEXTOS_COMPARTIDOS)].map((si) =>
    [...si[1].matchAll(TEXTO_TODOS)].map((t) => t[1]).join(""),
  );
}

/**
 * Celdas de una hoja por referencia. `comparable` es la formula si hay, si no
 * el texto o numero de la celda, con los textos compartidos resueltos: sirve
 * para comparar dos planillas.
 */
export function celdas(xml: string, compartidos: string[]) {
  const resultado = new Map<string, Celda>();

  for (const [, atributos] of xml.matchAll(CELDA_VACIA)) {
    resultado.set(ref(atributos), { atributos, comparable: "", contenido: "" });
  }

  for (const [, atributos, contenido] of xml.matchAll(CELDA)) {
    const formula = FORMULA.exec(contenido);
    let comparable: string;

    if (formula) {
      comparable = `=${formula[1] ?? ""}`;
    } else {
      const valor = VALOR.exec(contenido);
      const texto = TEXTO.exec(contenido);
      if (atributos.includes('t="s"') && valor) {
        comparable = compartidos[Number(valor[1])] ?? "";
      } else if (texto) {
        comparable = texto[1];
      } else {
        comparable = valor ? valor[1] : "";
      }
    }

    resultado.set(ref(atributos), { atributos, comparable, contenido });
  }

  return resultado;
}

/**
 * Pone en las celdas de Vimarx el contenido de la planilla actual de Sol Web.
 * Conserva el estilo de la planilla nueva (atributo s) y pasa los textos
 * compartidos de la planilla actual a texto en la celda, porque los indices no
 * son los mismos entre archivos.
 */
function adaptarDatos(
  xml: string,
  compartidos: string[],
  xmlActual: string,
  compartidosActual: string[],
) {
  const nuevas = celdas(xml, compartidos);
  const actuales = celdas(xmlActual, compartidosActual);
  // Una formula compartida (<f t="shared" si="0"/>) no repite el texto: esta
  // en la celda madre del grupo. Si la madre llama a Vimarx, todo el grupo.
  const gruposVimarx = new Set(
    [...xml.matchAll(FORMULA_MADRE)]
      .filter(([, , texto]) => FUNCIONES_VIMARX.test(texto))
      .map(([, si]) => si),
  );
  const deVimarx = new Set(
    [...nuevas].flatMap(([referencia, { contenido }]) => {
      const grupo = GRUPO.exec(contenido)?.[1];
      return FUNCIONES_VIMARX.test(contenido) ||
        (grupo !== undefined && gruposVimarx.has(grupo))
        ? [referencia]
        : [];
    }),
  );

  const distintas = [...new Set([...nuevas.keys(), ...actuales.keys()])]
    .filter((referencia) => !deVimarx.has(referencia))
    .filter(
      (referencia) =>
        (nuevas.get(referencia)?.comparable ?? "") !==
        (actuales.get(referencia)?.comparable ?? ""),
    )
    .sort();

  if (distintas.length > 0) {
    throw new CalculadoraNoAdaptableError(
      `En la hoja "${HOJA_DATOS}" cambiaron celdas que no son llamadas a Vimarx: ${distintas.join(", ")}. Hay que adaptarlas a mano.`,
    );
  }

  const adaptado = xml.replace(CELDA, (celda, atributos: string) => {
    const referencia = ref(atributos);
    if (!deVimarx.has(referencia)) {
      return celda;
    }
    const sinTipo = atributos.replace(TIPO, "");
    const actual = actuales.get(referencia);
    if (!actual || !actual.contenido) {
      return `<c${sinTipo}/>`;
    }
    if (actual.atributos.includes('t="s"')) {
      const indice = Number(VALOR.exec(actual.contenido)?.[1]);
      const texto = compartidosActual[indice];
      return `<c${sinTipo} t="inlineStr"><is><t xml:space="preserve">${texto}</t></is></c>`;
    }
    const tipo = TIPO_UNO.exec(actual.atributos);
    return `<c${sinTipo}${tipo ? ` ${tipo[0]}` : ""}>${actual.contenido}</c>`;
  });

  return { adaptadas: deVimarx.size, xml: adaptado };
}

function numerosConComaANumero(xml: string) {
  let convertidos = 0;
  const convertido = xml.replace(FORMULA_TODAS, (formula) =>
    formula.replace(NUMERO_CON_COMA, (_, entero: string, decimales: string) => {
      convertidos += 1;
      return `${entero}.${decimales}`;
    }),
  );
  return { convertidos, xml: convertido };
}

function ref(atributos: string) {
  const encontrada = REF.exec(atributos)?.[1];
  if (!encontrada) {
    throw new CalculadoraNoAdaptableError("Hay una celda sin referencia.");
  }
  return encontrada;
}

function escaparRegex(texto: string) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
