import { apiClient } from "@/shared/services/http/api-client";

import type {
  CheckCuitResponse,
  CheckDocumentoResponse,
  CreateSocioRequest,
  LookupSocioResponse,
  Socio,
  UpdateSocioRequest,
} from "../types";

export type GetSociosParams = {
  limit: number;
  offset: number;
  search?: string;
};

export type GetSociosResponse = {
  items: Socio[];
  total: number;
};

export function getSocios(params: GetSociosParams) {
  const searchParams = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
    ...(params.search ? { search: params.search } : {}),
  });

  return apiClient.get<GetSociosResponse>(
    `/api/socios?${searchParams.toString()}`,
  );
}

export function lookupSocioByDocumento(
  documento: string,
  tipoDocumento?: string,
) {
  const searchParams = new URLSearchParams({
    documento,
    ...(tipoDocumento ? { tipoDocumento } : {}),
  });

  return apiClient.get<LookupSocioResponse>(
    `/api/socios/lookup?${searchParams.toString()}`,
  );
}

export function checkCuitDuplicate(cuit: string, excludeSocioId?: string) {
  const searchParams = new URLSearchParams({
    cuit,
    ...(excludeSocioId ? { excludeSocioId } : {}),
  });

  return apiClient.get<CheckCuitResponse>(
    `/api/socios/check-cuit?${searchParams.toString()}`,
  );
}

export function checkDocumentoDuplicate(
  nroDocumento: string,
  excludeSocioId?: string,
) {
  const searchParams = new URLSearchParams({
    nroDocumento,
    ...(excludeSocioId ? { excludeSocioId } : {}),
  });

  return apiClient.get<CheckDocumentoResponse>(
    `/api/socios/check-documento?${searchParams.toString()}`,
  );
}

export function createSocio(payload: CreateSocioRequest) {
  return apiClient.post<Socio>("/api/socios", payload);
}

export type SyncSociosFromLegacySummary = {
  fetched: number;
  inserted: number;
  skippedDuplicateCuit: number;
  skippedDuplicateNroDocumento: number;
  skippedIncompleteFisica: number;
  skippedMissingCuit: number;
  upserted: number;
};

const SYNC_SOCIOS_FROM_LEGACY_TIMEOUT_MS = 5 * 60 * 1000;

export function syncSociosFromLegacy() {
  return apiClient.post<SyncSociosFromLegacySummary>(
    "/api/socios/sync-legacy",
    undefined,
    SYNC_SOCIOS_FROM_LEGACY_TIMEOUT_MS,
  );
}

export function updateSocio(socioId: string, payload: UpdateSocioRequest) {
  return apiClient.patch<Socio>(`/api/socios/${socioId}`, payload);
}

export function deleteSocio(socioId: string) {
  return apiClient.delete<void>(`/api/socios/${socioId}`);
}
