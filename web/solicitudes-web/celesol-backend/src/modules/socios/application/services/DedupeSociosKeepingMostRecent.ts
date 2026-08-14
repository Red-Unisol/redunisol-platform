import type { MappedSocioRow } from "./ClassifySocioMutualRow";

export type DedupeSociosResult = {
  rows: MappedSocioRow[];
  skippedDuplicateCuit: number;
  skippedDuplicateNroDocumento: number;
};

// nroSocioLegacy es el ID interno de Vimax (string) -- se usa como proxy de
// "mas reciente": ante un duplicado, gana el ID mas alto. Una fila sin
// nroSocioLegacy se trata como la mas vieja posible (nunca gana un empate).
function idOf(row: MappedSocioRow): number {
  return row.nroSocioLegacy === null ? -Infinity : Number(row.nroSocioLegacy);
}

/**
 * Resuelve duplicados de CUIT y de nro_documento (ambos UNIQUE en la tabla
 * `socios`) quedandose con la fila mas reciente de cada grupo, sin importar
 * el orden en que llegaron (Vimax no garantiza orden dentro de una pagina de
 * EvaluateList).
 *
 * Dos pasadas: primero se resuelve por CUIT (cada CUIT solo puede tener una
 * fila), y sobre esas sobrevivientes se resuelve por nro_documento (puede
 * haber dos CUIT distintos con el mismo documento en Vimax). Una eliminacion
 * en la primera pasada puede exponer un nuevo choque de documento en la
 * segunda -- por eso van en ese orden y no al reves.
 */
export function dedupeSociosKeepingMostRecent(
  rows: MappedSocioRow[],
): DedupeSociosResult {
  const byCuit = new Map<string, MappedSocioRow>();
  let skippedDuplicateCuit = 0;

  for (const row of rows) {
    const existing = byCuit.get(row.cuit);

    if (!existing) {
      byCuit.set(row.cuit, row);
      continue;
    }

    skippedDuplicateCuit += 1;

    if (idOf(row) > idOf(existing)) {
      byCuit.set(row.cuit, row);
    }
  }

  const byNroDocumento = new Map<string, MappedSocioRow>();
  let skippedDuplicateNroDocumento = 0;
  const result: MappedSocioRow[] = [];

  for (const row of byCuit.values()) {
    if (row.nroDocumento === null) {
      result.push(row);
      continue;
    }

    const existing = byNroDocumento.get(row.nroDocumento);

    if (!existing) {
      byNroDocumento.set(row.nroDocumento, row);
      continue;
    }

    skippedDuplicateNroDocumento += 1;

    if (idOf(row) > idOf(existing)) {
      byNroDocumento.set(row.nroDocumento, row);
    }
  }

  result.push(...byNroDocumento.values());

  return { rows: result, skippedDuplicateCuit, skippedDuplicateNroDocumento };
}
