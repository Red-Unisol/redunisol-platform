import { apiClient } from "@/shared/services/http/api-client";

export type CondicionSocio = "member" | "none" | "unknown";
export type CbuHabitualResponse =
  | { status: "available"; cbu: string }
  | { status: "missing" | "not_member" | "ambiguous" | "unavailable"; cbu: null };
export const datosRapidosApi = {
  cbu: (id: string) =>
    apiClient.get<CbuHabitualResponse>(`/solicitudes/${id}/datos-rapidos/cbu`),
  socio: (id: string) =>
    apiClient.get<{ condicion: CondicionSocio }>(
      `/solicitudes/${id}/datos-rapidos/socio`,
    ),
  convenio: (id: string) =>
    apiClient.get<{ descripcion: string | null }>(
      `/solicitudes/${id}/datos-rapidos/convenio`,
    ),
  mora: (id: string) =>
    apiClient.get<{ enMora: boolean | null }>(
      `/solicitudes/${id}/datos-rapidos/mora`,
    ),
  creditos: (id: string) =>
    apiClient.get<{ activos: boolean | null }>(
      `/solicitudes/${id}/datos-rapidos/creditos`,
    ),
};
