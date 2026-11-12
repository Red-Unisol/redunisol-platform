import { apiClient } from "@/shared/services/http/api-client";

export type PadronesSource = {
  id: string;
  name: string;
  kind: "padron" | "bajas";
  status: "ready" | "unpublished" | "needs_review";
  period: string | null;
  loaded_at: string | null;
  matches: { row: number; data: Record<string, string> }[];
};
export type PadronesResponse =
  | {
      status: "available";
      document: string;
      queried_at: string;
      sources: PadronesSource[];
    }
  | { status: "unavailable" | "not_configured" | "missing_document" };
export const getSolicitudPadrones = (id: string) =>
  apiClient.get<PadronesResponse>(`/solicitudes/${id}/padrones`);
