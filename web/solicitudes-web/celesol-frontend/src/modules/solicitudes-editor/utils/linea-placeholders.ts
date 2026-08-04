import type { LineaPrestamoPresolicitud } from "@/modules/solicitudes/types/solicitudes";

import { formatNullableAmount } from "./money-format";

export function getMontoAFinanciarPlaceholder(
  selectedLinea: LineaPrestamoPresolicitud | undefined,
) {
  if (!selectedLinea) {
    return "Seleccione una línea para ver el monto máximo";
  }

  const montoMaximo = formatNullableAmount(selectedLinea.montoMaximo);

  return montoMaximo
    ? `Monto máximo a financiar: ${montoMaximo}`
    : "La línea no informa monto máximo";
}

export function getCuotasPlaceholder(
  selectedLinea: LineaPrestamoPresolicitud | undefined,
) {
  if (!selectedLinea) {
    return "Seleccione una línea para ver el máximo de cuotas";
  }

  return typeof selectedLinea.cantidadMaximaCuotas === "number"
    ? `Máximo de cuotas: ${selectedLinea.cantidadMaximaCuotas}`
    : "La línea no informa máximo de cuotas";
}

export function getCupoTitularPlaceholder(
  selectedLinea: LineaPrestamoPresolicitud | undefined,
) {
  return selectedLinea ? "" : "Seleccione una línea para ver cupo titular";
}
