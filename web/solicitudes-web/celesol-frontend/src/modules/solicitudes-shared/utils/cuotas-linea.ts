type LineaConLimitesDeCuotas = {
  cantidadMaximaCuotas: number | null;
  cantidadMinimaCuotas: number | null;
};

/**
 * Mensaje de error si la cantidad de cuotas no respeta los limites de la
 * linea, o null si esta bien (o si no hay linea o cuotas para comparar).
 *
 * Hace falta porque Vimarx no rechaza un valor fuera de rango: lo corrige
 * solo al calcular. Con 8 cuotas en una linea de hasta 6, la cuota sale
 * calculada con 6 mientras el campo sigue mostrando 8.
 *
 * Mismos mensajes que la validacion del editor de solicitudes del legado.
 */
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
  const max = linea.cantidadMaximaCuotas;

  if (min !== null && numero < min) {
    return `La línea requiere al menos ${min} cuotas.`;
  }

  if (max !== null && numero > max) {
    return `La línea permite hasta ${max} cuotas.`;
  }

  return null;
}
