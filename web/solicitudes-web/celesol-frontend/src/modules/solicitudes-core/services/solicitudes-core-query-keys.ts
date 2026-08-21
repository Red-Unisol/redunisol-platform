const solicitudesCoreRootKey = ["solicitudes-core"] as const;
const solicitudesCorePrecargaRootKey = [
  ...solicitudesCoreRootKey,
  "precarga",
] as const;
const solicitudesCoreRecientesRootKey = [
  ...solicitudesCoreRootKey,
  "recientes",
] as const;
const solicitudesCoreHistoricasRootKey = [
  ...solicitudesCoreRootKey,
  "historicas",
] as const;

export const solicitudesCoreQueryKeys = {
  all: solicitudesCoreRootKey,
  assignmentAgents: (id: string) =>
    [...solicitudesCoreRootKey, "assignment-agents", id] as const,
  adjuntos: (id: string) =>
    [...solicitudesCoreRootKey, "adjuntos", id] as const,
  cancelaciones: (id: string) =>
    [...solicitudesCoreRootKey, "cancelaciones", id] as const,
  detail: (id: string) => [...solicitudesCoreRootKey, "detail", id] as const,
  history: (id: string) => [...solicitudesCoreRootKey, "history", id] as const,
  lineasPrestamo: [...solicitudesCoreRootKey, "lineas-prestamo"] as const,
  sociosCancelaciones: [
    ...solicitudesCoreRootKey,
    "socios-cancelaciones",
  ] as const,
  precargaAll: solicitudesCorePrecargaRootKey,
  precarga: (input: { limit: number; nroDocumento?: string; offset: number }) =>
    [...solicitudesCorePrecargaRootKey, input] as const,
  tiposAdjunto: [...solicitudesCoreRootKey, "tipos-adjunto"] as const,
  recientesAll: solicitudesCoreRecientesRootKey,
  historicasAll: solicitudesCoreHistoricasRootKey,
  historicas: (input: {
    limit: number;
    nroDocumento?: string;
    offset: number;
  }) => [...solicitudesCoreHistoricasRootKey, input] as const,
  recientes: (input: {
    createdFrom: string;
    createdTo: string;
    excludeEstado?: string;
    limit: number;
    nroDocumento?: string;
    offset: number;
    scope?: "historicas" | "recientes" | "tracking" | "work";
  }) => [...solicitudesCoreRecientesRootKey, input] as const,
  transitions: (id: string) =>
    [...solicitudesCoreRootKey, "transitions", id] as const,
};
