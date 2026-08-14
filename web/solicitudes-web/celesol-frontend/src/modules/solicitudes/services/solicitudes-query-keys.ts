export const solicitudesQueryKeys = {
  all: ["solicitudes"] as const,
  historicas: (max: number) =>
    [...solicitudesQueryKeys.all, "historicas", { max }] as const,
  precarga: (max: number) =>
    [...solicitudesQueryKeys.all, "precarga", { max }] as const,
  recientes: (max: number) =>
    [...solicitudesQueryKeys.all, "recientes", { max }] as const,
};
