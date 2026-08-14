import type { MappedSocioRow } from "../../application/services/ClassifySocioMutualRow";

// Orden de columnas de cada VALUES tuple. "id" via gen_random_uuid() (la
// tabla no tiene default a nivel de base) y created_at/updated_at explicitos
// (bypassea Prisma Client, que es quien normalmente los completa).
//
// Compartido entre el seed standalone (INSERT ... DO NOTHING, scripts/
// pull-socios-vimax.ts) y el upsert en vivo (INSERT ... DO UPDATE SET,
// disparado desde el boton "Actualizar desde Vimax" de la UI) -- ambos
// escriben exactamente las mismas columnas por fila, solo cambia la clausula
// final de conflicto.
export const SOCIO_LEGACY_COLUMNS = [
  "tipo_persona",
  "cuit",
  "nro_documento",
  "tipo_documento",
  "apellido",
  "nombre",
  "razon_social",
  "sexo",
  "email",
  "celular",
  "nro_socio_legacy",
  "fecha_de_nacimiento",
] as const;

export function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''");
}

export function sqlLiteral(value: string | null): string {
  if (value === null) {
    return "NULL";
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return "NULL";
  }

  return `'${escapeSqlString(trimmed)}'`;
}

export function buildSocioColumnsSql(): string {
  return [
    '"id"',
    ...SOCIO_LEGACY_COLUMNS.map((column) => `"${column}"`),
    '"created_at"',
    '"updated_at"',
  ].join(", ");
}

export function buildSocioRowValuesSql(row: MappedSocioRow): string {
  const values = [
    "gen_random_uuid()",
    sqlLiteral(row.tipoPersona),
    sqlLiteral(row.cuit),
    sqlLiteral(row.nroDocumento),
    sqlLiteral(row.tipoDocumento),
    sqlLiteral(row.apellido),
    sqlLiteral(row.nombre),
    sqlLiteral(row.razonSocial),
    sqlLiteral(row.sexo),
    sqlLiteral(row.email),
    sqlLiteral(row.celular),
    sqlLiteral(row.nroSocioLegacy),
    sqlLiteral(row.fechaDeNacimiento),
    "CURRENT_TIMESTAMP",
    "CURRENT_TIMESTAMP",
  ];

  return `(${values.join(", ")})`;
}
