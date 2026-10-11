// Las fechas legacy son fechas de calendario, aunque incluyan hora. No se
// convierten a UTC. El día actual sí se obtiene en la zona de negocio argentina.
export const CUOTAS_TIME_ZONE = "America/Argentina/Buenos_Aires";

type Cuota = {
  fecha: string | null;
  fechaCobro?: string | null;
  nroCuota: number | null;
};
export type EstadoCobro =
  | "cobrada"
  | "mes-anterior"
  | "vencida"
  | "pendiente"
  | "sin-vencimiento"
  | "desconocido";

export function diaLegacy(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/.exec(
      value.trim(),
    );
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T12:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== `${year}-${month}-${day}`
  )
    return null;
  return `${year}-${month}-${day}`;
}

export function diaDeNegocio(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CUOTAS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function estadoCobro(cuota: Cuota, hoy: string): EstadoCobro {
  if (diaLegacy(cuota.fechaCobro)) return "cobrada";
  // Solo null y cadenas vacías confirman que no hubo cobro. Una columna
  // ausente, un formato inesperado o una fecha imposible no confirman mora.
  if (cuota.fechaCobro !== null && cuota.fechaCobro?.trim() !== "")
    return "desconocido";
  const vencimiento = diaLegacy(cuota.fecha);
  if (!vencimiento || !diaLegacy(hoy)) return "sin-vencimiento";
  const [year, month] = hoy.split("-").map(Number);
  const mesAnterior = `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, "0")}`;
  if (vencimiento.slice(0, 7) === mesAnterior) return "mes-anterior";
  return vencimiento < hoy ? "vencida" : "pendiente";
}

export function vistaCuotas<T extends Cuota>(
  cuotas: readonly T[],
  expandida: boolean,
  hoy: string,
) {
  const filas = [...cuotas]
    .sort((a, b) => (a.nroCuota ?? -1) - (b.nroCuota ?? -1))
    .map((cuota) => ({ cuota, estado: estadoCobro(cuota, hoy) }));
  const cobradas = filas.filter((fila) => fila.estado === "cobrada");
  const ultimaCobrada = cobradas.at(-1);
  return {
    cantidadOcultas: Math.max(0, cobradas.length - 1),
    filas: filas
      .filter(
        (fila) =>
          expandida || fila.estado !== "cobrada" || fila === ultimaCobrada,
      )
      .map((fila) => ({ ...fila, ultimaCobrada: fila === ultimaCobrada })),
  };
}

export const ETIQUETAS_COBRO: Record<EstadoCobro, string> = {
  cobrada: "Cobrada",
  "mes-anterior": "Pendiente · mes anterior",
  vencida: "Vencida sin cobro",
  pendiente: "Pendiente · no vencida",
  "sin-vencimiento": "Pendiente · vencimiento no disponible",
  desconocido: "Estado de cobro no disponible",
};
