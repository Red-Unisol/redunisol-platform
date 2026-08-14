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

export function parseMoneyValue(value: string) {
  const digits = getMoneyDigits(value);

  return digits ? Number(digits) : 0;
}

export function formatNullableAmount(value: number | null | undefined) {
  return typeof value === "number" ? `$${numberFormatter.format(value)}` : "";
}
