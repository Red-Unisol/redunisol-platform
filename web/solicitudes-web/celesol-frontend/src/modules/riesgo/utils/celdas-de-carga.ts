export type RangoReferenciado = {
  hoja: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

// Hoja opcional (con o sin comillas), celda o rango A1. Se descartan los
// nombres de función que terminan en dígitos (LOG10, ATAN2) y las referencias
// pegadas a otro identificador.
const REFERENCIA =
  /(?<![\w.$])(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?(?![\w(])/g;

function columna(letras: string) {
  let n = 0;
  for (const letra of letras) n = n * 26 + letra.charCodeAt(0) - 64;
  return n - 1;
}

/** Celdas y rangos A1 que lee una fórmula; las filas y columnas van en base 0. */
export function referenciasDeFormula(
  formula: string,
  hojaActual: string,
): RangoReferenciado[] {
  // Los textos entre comillas ("A1") no son referencias.
  const sinTextos = formula.replace(/"(?:[^"]|"")*"/g, '""');
  return [...sinTextos.matchAll(REFERENCIA)].map(
    ([, citada, simple, col1, fila1, col2, fila2]) => {
      const [c1, c2] = [columna(col1), columna(col2 ?? col1)];
      const [f1, f2] = [Number(fila1) - 1, Number(fila2 ?? fila1) - 1];
      return {
        hoja: citada?.replaceAll("''", "'") ?? simple ?? hojaActual,
        startRow: Math.min(f1, f2),
        endRow: Math.max(f1, f2),
        startColumn: Math.min(c1, c2),
        endColumn: Math.max(c1, c2),
      };
    },
  );
}
