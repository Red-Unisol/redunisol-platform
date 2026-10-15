type LineaConLimitesDeCuotas = {
  cantidadMaximaCuotas: number | null;
  cantidadMinimaCuotas: number | null;
};

/** Mantiene la validación de formato, positividad y mínimos. Los máximos se ajustan antes de validar/calcular. */
export function getCuotasFueraDeLineaError(
  cuotas: string,
  linea: LineaConLimitesDeCuotas | null | undefined,
) {
  const valor = cuotas.trim();

  if (!valor || !linea) {
    return null;
  }

  const numero = Number(valor);

  if (!Number.isInteger(numero) || numero <= 0) {
    return "Ingrese un número de cuotas válido.";
  }

  const min = linea.cantidadMinimaCuotas;

  if (min !== null && numero < min) {
    return `La línea requiere al menos ${min} cuotas.`;
  }


  return null;
}
