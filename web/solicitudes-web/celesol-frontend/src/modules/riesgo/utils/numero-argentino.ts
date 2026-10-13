/** Solo importes inequívocos con separadores argentinos; los demás textos quedan intactos. */
export function numeroArgentino(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/^(?:ARS\s*|\$\s*)/, "");
  if (!/[.,]/.test(text)) return null;
  if (!/^[+-]?(?:0|[1-9]\d*|[1-9]\d{0,2}(?:\.\d{3})+)(?:,\d+)?$/.test(text))
    return null;
  const parsed = Number(text.replaceAll(".", "").replace(",", "."));
  return Number.isFinite(parsed) && Math.abs(parsed) <= Number.MAX_SAFE_INTEGER
    ? parsed
    : null;
}

/** Una lista o tabla de importes pegada como texto se conserva como celdas separadas. */
export function tablaNumerosArgentinos(value: unknown): string | null {
  if (typeof value !== "string" || !/[\t\r\n]/.test(value)) return null;
  const rows = value
    .replace(/\r\n?/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((row) => row.split("\t"));
  const cells = rows.flat();
  if (
    !cells.some((cell) => numeroArgentino(cell) !== null) ||
    cells.some((cell) => cell.trim() !== "" && numeroArgentino(cell) === null)
  )
    return null;
  const escape = (text: string) =>
    text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  return `<table>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`).join("")}</table>`;
}
