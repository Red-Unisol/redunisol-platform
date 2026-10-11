import { apiClient } from "@/shared/services/http/api-client";

export type CondicionSocio = "member" | "none" | "unknown";
export const datosRapidosApi = {
  socio: (id: string) =>
    apiClient.get<{ condicion: CondicionSocio }>(
      `/solicitudes/${id}/datos-rapidos/socio`,
    ),
  convenio: (id: string) =>
    apiClient.get<{ descripcion: string | null }>(
      `/solicitudes/${id}/datos-rapidos/convenio`,
    ),
  creditos: (id: string) =>
    apiClient.get<{ vigentes: boolean | null }>(
      `/solicitudes/${id}/datos-rapidos/creditos`,
    ),
};
