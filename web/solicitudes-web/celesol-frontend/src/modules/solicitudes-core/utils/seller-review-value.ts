import { sexoLegible } from "@/modules/solicitudes-editor/constants/legacy-options";
import { formatLegacyDate } from "./legacy-date-format";

const booleanFields = new Set([
  "firmaDigitalmente",
  "personaExpuestaPoliticamente",
  "casadoConTitular",
  "sumaIngresos",
]);

export function formatReviewValue(field: string, value: string | null) {
  if (value === null) return "Sin cargar";
  if (/\.fecha[A-Z]/.test(field)) return formatLegacyDate(value);
  if (booleanFields.has(field.split(".").at(-1) ?? ""))
    return value === "true" ? "Sí" : "No";
  if (field.endsWith(".sexo")) return sexoLegible(value);
  return value;
}
