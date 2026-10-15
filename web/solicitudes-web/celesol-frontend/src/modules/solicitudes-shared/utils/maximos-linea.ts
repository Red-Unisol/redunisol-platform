import {
  formatMoneyAmount,
  parseMoneyValue,
} from "@/shared/utils/money-format";
export type MaximosLinea = {
  montoMaximo?: number | null;
  cantidadMaximaCuotas?: number | null;
};
export function ajustarMontoTexto(
  value: string,
  linea?: MaximosLinea | null,
): string {
  const max = linea?.montoMaximo;
  return typeof max === "number" &&
    Number.isFinite(max) &&
    max > 0 &&
    parseMoneyValue(value) > max
    ? formatMoneyAmount(max)
    : value;
}
export function ajustarCuotasTexto(
  value: string,
  linea?: MaximosLinea | null,
): string {
  const max = linea?.cantidadMaximaCuotas;
  return typeof max === "number" &&
    Number.isSafeInteger(max) &&
    max > 0 &&
    Number(value) > max
    ? String(max)
    : value;
}
