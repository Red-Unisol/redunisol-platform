import type { LegacyLineaPrestamo } from "../../domain/services/LineasPrestamoCatalog";
import { ConfiguracionMaximosLineaInvalidaError } from "../../domain/solicitudes-core-errors";

export function ajustarMaximosLinea(
  linea: LegacyLineaPrestamo,
  valores: { montoAFinanciar: number | null; cuotas: number | null },
) {
  const montoMaximo = linea.montoMaximo;
  const cantidadMaximaCuotas = linea.cantidadMaximaCuotas;
  if (
    typeof montoMaximo !== "number" ||
    !Number.isFinite(montoMaximo) ||
    montoMaximo <= 0 ||
    typeof cantidadMaximaCuotas !== "number" ||
    !Number.isSafeInteger(cantidadMaximaCuotas) ||
    cantidadMaximaCuotas <= 0 ||
    (linea.montoMinimo != null && linea.montoMinimo > montoMaximo) ||
    (linea.cantidadMinimaCuotas != null &&
      linea.cantidadMinimaCuotas > cantidadMaximaCuotas)
  ) {
    throw new ConfiguracionMaximosLineaInvalidaError();
  }
  return {
    montoAFinanciar:
      valores.montoAFinanciar === null
        ? null
        : Math.min(valores.montoAFinanciar, montoMaximo),
    cuotas:
      valores.cuotas === null
        ? null
        : Math.min(valores.cuotas, cantidadMaximaCuotas),
  };
}
