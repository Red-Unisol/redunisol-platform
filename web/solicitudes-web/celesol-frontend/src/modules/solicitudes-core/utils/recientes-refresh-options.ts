// Reutiliza el ciclo de React Query: deduplicación por clave, pausa sin red,
// pausa de intervalos en pestañas ocultas y recuperación al volver a la pestaña.
// El intervalo de Precarga e Históricas continúa en 60 segundos.
export const RECIENTES_REFRESH_MS = 15_000;
export const recientesRefreshOptions = {
  refetchInterval: RECIENTES_REFRESH_MS,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  networkMode: "online",
  staleTime: 0,
  retry: false,
} as const;

export function recientesRefreshLabel(input: {
  isFetching: boolean;
  isError: boolean;
  isPaused: boolean;
  dataUpdatedAt: number;
  now: number;
}) {
  if (input.isFetching) return "Actualizando…";
  if (input.isError) return "No se pudo actualizar";
  if (input.isPaused) return "Sin conexión";
  if (!input.dataUpdatedAt) return "Sin actualizar";
  const seconds = Math.max(
    0,
    Math.floor((input.now - input.dataUpdatedAt) / 1000),
  );
  return `Actualizado hace ${seconds} ${seconds === 1 ? "segundo" : "segundos"}`;
}
