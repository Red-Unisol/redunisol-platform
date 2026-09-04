const numberFormatter = new Intl.NumberFormat("es-AR");

function getMoneyDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function formatMoneyValue(value: string) {
  const digits = getMoneyDigits(value);

  if (!digits) {
    return "";
  }

  return `$${numberFormatter.format(Number(digits))}`;
}

const decimalFormatter = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

/**
 * Para importes CON centavos, como la cuota resultante: "677.916,20".
 *
 * No usar formatMoneyValue para esos valores: descarta todo lo que no sea
 * digito, asi que 677916.2 termina como $6.779.162 -- diez veces mas grande y
 * sin centavos.
 */
export function formatDecimalMoneyValue(value: number | string) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? decimalFormatter.format(parsed) : "";
}

export function parseMoneyValue(value: string) {
  const digits = getMoneyDigits(value);

  return digits ? Number(digits) : 0;
}

export function formatNullableAmount(value: number | null | undefined) {
  return typeof value === "number" ? `$${numberFormatter.format(value)}` : "";
}
