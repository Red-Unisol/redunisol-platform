import type { SimulacionPrestamo } from "../../../solicitudes/infrastructure/services/PrestamosSimulacionGateway";
import { PrestamoSimulacionRechazadaError } from "../../../solicitudes/domain/solicitudes-errors";

/** Solves against real simulations, never assuming a proportional installment. */
export async function calcularMontoPorCuota(input: {
  cuotaObjetivo: number;
  montoMinimo: number;
  montoMaximo: number;
  simular: (monto: number) => Promise<SimulacionPrestamo>;
}): Promise<SimulacionPrestamo> {
  const { cuotaObjetivo, simular } = input;
  if (
    !Number.isFinite(cuotaObjetivo) ||
    cuotaObjetivo <= 0 ||
    !Number.isFinite(input.montoMinimo) ||
    input.montoMinimo <= 0 ||
    !Number.isFinite(input.montoMaximo) ||
    input.montoMaximo < input.montoMinimo
  ) {
    throw new PrestamoSimulacionRechazadaError(
      "La cuota o el rango de montos no es válido para calcular la propuesta.",
    );
  }
  let min = await simular(input.montoMinimo);
  let max =
    input.montoMinimo === input.montoMaximo
      ? min
      : await simular(input.montoMaximo);
  const matches = (result: SimulacionPrestamo) =>
    Math.abs(result.cuotaResultante - cuotaObjetivo) <= 0.01;
  // Varios montos a centavos de distancia dan la misma cuota (280.000 y
  // 280.000,02): si el entero mas cercano tambien coincide, se prefiere ese.
  const preferirMontoEntero = async (result: SimulacionPrestamo) => {
    const entero = Math.round(result.montoAFinanciar);
    if (
      entero === result.montoAFinanciar ||
      entero < input.montoMinimo ||
      entero > input.montoMaximo
    )
      return result;
    try {
      const redondeado = await simular(entero);
      return matches(redondeado) ? redondeado : result;
    } catch {
      // El monto encontrado ya es valido: no perderlo por la prueba extra.
      return result;
    }
  };
  if (matches(min)) return min;
  if (max.cuotaResultante < min.cuotaResultante) {
    throw new PrestamoSimulacionRechazadaError(
      "La línea no permite calcular el monto por cuota con esas condiciones.",
    );
  }
  // A target above the allowed financing range uses the existing maximum.
  if (cuotaObjetivo >= max.cuotaResultante) return max;
  if (
    cuotaObjetivo < min.cuotaResultante ||
    max.cuotaResultante <= min.cuotaResultante
  ) {
    throw new PrestamoSimulacionRechazadaError(
      "La cuota deseada no corresponde a un monto permitido por la línea.",
    );
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    const estimate =
      min.montoAFinanciar +
      ((max.montoAFinanciar - min.montoAFinanciar) *
        (cuotaObjetivo - min.cuotaResultante)) /
        (max.cuotaResultante - min.cuotaResultante);
    let amount = Math.round(estimate * 100) / 100;
    if (amount <= min.montoAFinanciar || amount >= max.montoAFinanciar) {
      amount =
        Math.round((min.montoAFinanciar + max.montoAFinanciar) * 50) / 100;
    }
    if (amount <= min.montoAFinanciar || amount >= max.montoAFinanciar) break;
    const result = await simular(amount);
    if (matches(result)) return preferirMontoEntero(result);
    if (
      result.cuotaResultante < min.cuotaResultante ||
      result.cuotaResultante > max.cuotaResultante
    )
      break;
    if (result.cuotaResultante < cuotaObjetivo) min = result;
    else max = result;
  }
  throw new PrestamoSimulacionRechazadaError(
    "No se pudo obtener un monto para esa cuota con las condiciones de la línea.",
  );
}
