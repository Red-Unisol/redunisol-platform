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
  revisionPrestamo: (id: string, condiciones: string) =>
    [...solicitudesCoreRootKey, "revision-prestamo", id, condiciones] as const,
  assignmentAgents: (id: string) =>
    [...solicitudesCoreRootKey, "assignment-agents", id] as const,
  adjuntos: (id: string) =>
    [...solicitudesCoreRootKey, "adjuntos", id] as const,
  cancelaciones: (id: string) =>
    [...solicitudesCoreRootKey, "cancelaciones", id] as const,
  solicitudesDelTitular: (id: string, documento: string | null) =>
    [...solicitudesCoreRootKey, "solicitudes-titular", id, documento] as const,
  prestamosDelSocio: (id: string) =>
    [...solicitudesCoreRootKey, "prestamos-socio", id] as const,
  prestamoDelSocio: (id: string, prestamoId: string) =>
    [...solicitudesCoreRootKey, "prestamos-socio", id, prestamoId] as const,
  credixsa: (id: string) => [...solicitudesCoreRootKey, "credixsa", id] as const,
  detail: (id: string) => [...solicitudesCoreRootKey, "detail", id] as const,
  history: (id: string) => [...solicitudesCoreRootKey, "history", id] as const,
  lineasPrestamo: (id: string) =>
    [...solicitudesCoreRootKey, "lineas-prestamo", id] as const,
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
    search?: string;
    vista?: "mi-area" | "todas";
    userId?: string;
    workflowOwnerId?: string | null;
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
