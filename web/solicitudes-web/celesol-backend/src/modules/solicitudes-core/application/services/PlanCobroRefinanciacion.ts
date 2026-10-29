export type TramoCobroRefinanciacion = {
  nrosCuota: number[];
  permitePagoFueraDeOrden: boolean;
};

/**
 * Parte las cuotas elegidas de un prestamo en los cobros que hace un analista
 * en una refinanciacion mixta:
 *
 * - las vencidas, en orden y sin "pago fuera de orden": asi Vimarx cobra los
 *   punitorios al dia;
 * - el resto (la del mes y las futuras), con "pago fuera de orden", para poder
 *   elegirlas sueltas. No llevan punitorios.
 *
 * Hace falta porque con "pago fuera de orden" Vimarx no cobra punitorios, y la
 * API no tiene el "Generar punitorio: al dia" de la pantalla (verificado en
 * FapiTest el 28/10/2026, prestamo 416228).
 *
 * Una cuota sin fecha conocida va con el resto: sin fecha no se puede decir
 * que este vencida.
 */
export function planCobroRefinanciacion(
  nrosCuota: readonly number[],
  cuotas: readonly { fecha: string | null; nroCuota: number | null }[],
  hoy: string,
): TramoCobroRefinanciacion[] {
  const vencimientos = new Map(
    cuotas
      .filter((cuota) => typeof cuota.nroCuota === "number")
      .map((cuota) => [cuota.nroCuota as number, cuota.fecha?.slice(0, 10) ?? null]),
  );
  const ordenadas = [...nrosCuota].sort((a, b) => a - b);
  const vencidas = ordenadas.filter((nro) => {
    const vencimiento = vencimientos.get(nro);
    return vencimiento !== undefined && vencimiento !== null && vencimiento < hoy;
  });
  const resto = ordenadas.filter((nro) => !vencidas.includes(nro));
  const tramos: TramoCobroRefinanciacion[] = [];

  if (vencidas.length > 0) {
    tramos.push({ nrosCuota: vencidas, permitePagoFueraDeOrden: false });
  }

  if (resto.length > 0) {
    tramos.push({ nrosCuota: resto, permitePagoFueraDeOrden: true });
  }

  return tramos;
}

/** Fecha de hoy en Argentina, "YYYY-MM-DD" (Vimarx vence por dia calendario). */
export function hoyEnArgentina(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}
