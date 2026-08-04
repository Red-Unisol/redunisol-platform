// Formatters puntuales para replicar el contrato de
// POST /api/redunisol/finSolicitud/:ntrans/:sol (ver
// finalizar-api-caja-celesol-contrato.txt en la raiz del repo). Cada campo
// del contrato tiene su propia convencion de formato observada en respuestas
// reales del legacy -- no hay un unico formato "moneda"/"decimal" comun.

export function parseArgentineDecimalString(
  value: string | null,
): number | null {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const digitsAndSeparators = trimmed.replace(/[^\d,.-]/g, "");
  const normalized = digitsAndSeparators.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);

  return Number.isNaN(parsed) ? null : parsed;
}

// "$ 489.100,00" -- usado por montoAfinanciar, CapitalOriginal, MontoPrestamo.
export function formatArsCurrency(value: number | null): string | null {
  if (value === null) {
    return null;
  }

  const formatted = new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value);

  return `$ ${formatted}`;
}

// "62867,5100" -- sin separador de miles, con la cantidad de decimales
// indicada. Usado por cuotaResultante y por prestamoTEM/TNA/TEA.
export function formatDecimalCommaNoGrouping(
  value: number | null,
  decimals: number,
): string | null {
  if (value === null) {
    return null;
  }

  return value.toFixed(decimals).replace(".", ",");
}

// El legacy devuelve CFT con precision arbitraria (BigDecimal sin redondear,
// ej. "2,0111995964885465985632216259"). Nosotros solo recibimos un double
// de JS (~15-17 digitos significativos de precision real) -- no podemos
// replicar esos ~28 digitos exactos. No hace falta: el consumidor
// (/finalizar) solo usa ~4-6 digitos significativos (multiplica por 100 y
// muestra el porcentaje), asi que un double con varios decimales de margen
// alcanza sobra para ese uso.
export function formatCftDecimalComma(value: number | null): string | null {
  if (value === null) {
    return null;
  }

  return value.toFixed(12).replace(".", ",");
}

// "2025-05-15T00:00:00" a partir de un valor "2025-05-15" o
// "2025-05-15T00:00:00" (nuestro core y el legacy devuelven la fecha sola,
// sin hora).
export function formatMidnightIsoDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return `${value.slice(0, 10)}T00:00:00`;
}
