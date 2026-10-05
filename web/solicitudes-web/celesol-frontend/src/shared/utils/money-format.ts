const numberFormatter = new Intl.NumberFormat("es-AR");

const decimalFormatter = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

/**
 * Formatea lo que alguien escribe en un campo de dinero, en formato argentino:
 * punto para los miles y coma para los centavos ("$850.000,50").
 *
 * Los puntos que se escriban se ignoran (son separadores de miles) y se
 * aceptan hasta dos decimales despues de la coma. La coma se conserva aunque
 * todavia no tenga decimales, para poder seguir escribiendo: "850000," y
 * despues "850000,5".
 *
 * Solo para texto escrito por una persona. Para un monto que ya es un numero,
 * como los que devuelve el backend, usar formatMoneyAmount: String(850000.5)
 * es "850000.5", y aca ese punto se leeria como separador de miles.
 */
export function formatMoneyValue(value: string) {
  const cleaned = value.replace(/[^\d,]/g, "");

  if (!cleaned) {
    return "";
  }

  const commaIndex = cleaned.indexOf(",");
  const entera = commaIndex === -1 ? cleaned : cleaned.slice(0, commaIndex);
  const enteraFormateada = numberFormatter.format(Number(entera || "0"));

  if (commaIndex === -1) {
    return `$${enteraFormateada}`;
  }

  const decimales = cleaned
    .slice(commaIndex + 1)
    .replace(/,/g, "")
    .slice(0, 2);

  return `$${enteraFormateada},${decimales}`;
}

/**
 * Un monto que ya es un numero, en el mismo formato que formatMoneyValue.
 * Muestra centavos solo si los tiene: 5000000 -> "$5.000.000",
 * 850000.5 -> "$850.000,50". Lo que devuelve se puede volver a leer con
 * parseMoneyValue sin perder nada.
 */
export function formatMoneyAmount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }

  const formatter = Number.isInteger(value) ? numberFormatter : decimalFormatter;

  return `$${formatter.format(value)}`;
}

/**
 * Para importes que siempre llevan centavos y sin signo peso, como la cuota
 * resultante: "677.916,20".
 */
export function formatDecimalMoneyValue(value: number | string) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? decimalFormatter.format(parsed) : "";
}

/**
 * Lee un monto en formato argentino: "$850.000,50" -> 850000.5. Los puntos son
 * separadores de miles y se ignoran; la coma separa los centavos. Devuelve 0
 * si no hay ningun digito.
 */
export function parseMoneyValue(value: string) {
  const cleaned = value.replace(/[^\d,]/g, "");

  if (!/\d/.test(cleaned)) {
    return 0;
  }

  const [entera = "", ...resto] = cleaned.split(",");
  const decimales = resto.join("").slice(0, 2);

  return Number(`${entera || "0"}.${decimales || "0"}`);
}

export function formatNullableAmount(value: number | null | undefined) {
  return typeof value === "number" ? `$${numberFormatter.format(value)}` : "";
}
