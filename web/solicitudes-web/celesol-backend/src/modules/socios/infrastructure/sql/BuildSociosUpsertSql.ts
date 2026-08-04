import type { MappedSocioRow } from "../../application/services/ClassifySocioMutualRow";
import {
  SOCIO_LEGACY_COLUMNS,
  buildSocioColumnsSql,
  buildSocioRowValuesSql,
} from "./SocioSqlValues";

const DEFAULT_ROWS_PER_STATEMENT = 500;

// Solo las columnas que vienen de Vimax (SOCIO_LEGACY_COLUMNS, salvo "cuit"
// -- es la clave del conflicto, reasignarla a si misma no aporta nada) mas
// updated_at se actualizan en un conflicto de cuit. domicilio_calle/
// nro_puerta/localidad/codigo_postal (cargados a mano, Vimax no los provee),
// id y created_at nunca se tocan -- por construccion, ya que no aparecen en
// SOCIO_LEGACY_COLUMNS.
function buildDoUpdateSetSql(): string {
  return [...SOCIO_LEGACY_COLUMNS.filter((column) => column !== "cuit"), "updated_at"]
    .map((column) => `"${column}" = EXCLUDED."${column}"`)
    .join(",\n    ");
}

function buildUpsertStatement(rows: MappedSocioRow[]): string {
  const valuesSql = rows.map(buildSocioRowValuesSql).join(",\n  ");

  return (
    `INSERT INTO "socios" (${buildSocioColumnsSql()})\n` +
    `VALUES\n  ${valuesSql}\n` +
    'ON CONFLICT ("cuit") DO UPDATE SET\n' +
    `    ${buildDoUpdateSetSql()};\n`
  );
}

/**
 * Arma las sentencias UPSERT (INSERT ... ON CONFLICT (cuit) DO UPDATE SET)
 * para escribir socios pulleados de Vimax en vivo, en lotes de
 * `rowsPerStatement`. A diferencia de `buildSociosSeedSql` (que devuelve un
 * unico string para un archivo), devuelve un array de sentencias para que el
 * caller las ejecute una por una (ej. `$executeRawUnsafe` por lote).
 */
export function buildSociosUpsertSql(
  rows: MappedSocioRow[],
  rowsPerStatement: number = DEFAULT_ROWS_PER_STATEMENT,
): string[] {
  const statements: string[] = [];

  for (let start = 0; start < rows.length; start += rowsPerStatement) {
    statements.push(buildUpsertStatement(rows.slice(start, start + rowsPerStatement)));
  }

  return statements;
}
