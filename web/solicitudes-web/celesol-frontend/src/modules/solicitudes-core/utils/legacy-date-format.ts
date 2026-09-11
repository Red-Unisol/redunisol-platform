const PLACEHOLDER = "-";

// El legado devuelve las fechas con hora ("2024-11-14T00:00:00"). Se corta en
// vez de parsear a Date a proposito: construir un Date corre la fecha un dia
// segun la zona horaria.
export function formatLegacyDate(value: string | null) {
  if (!value) {
    return PLACEHOLDER;
  }

  const [anio, mes, dia] = value.slice(0, 10).split("-");

  return dia && mes && anio ? `${dia}/${mes}/${anio}` : PLACEHOLDER;
}
