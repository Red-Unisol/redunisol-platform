import { apiClient } from "@/shared/services/http/api-client";
import { ApiError } from "@/shared/services/http/api-error";
import { DEFAULT_HTTP_TIMEOUT_MS } from "@/shared/services/http/http.constants";

import type {
  CreateSolicitudCoreCancelacionRequest,
  CreateSolicitudCoreRequest,
  CreateSolicitudCoreResponse,
  DownloadSolicitudCoreAdjuntoResponse,
  ExecuteWorkflowTransitionRequest,
  ExecuteWorkflowTransitionResponse,
  ListSolicitudesCoreQuery,
  PatchSolicitudCoreAdjuntoRequest,
  PatchSolicitudCoreRequest,
  SimularPrestamoRequest,
  SimulacionPrestamoResponse,
  SolicitudCoreAdjuntoResponse,
  SolicitudCoreAssignableAgent,
  SolicitudCoreCancelacionResponse,
  SolicitudCoreListItem,
  SolicitudCoreWorkflowHistoryItem,
  SolicitudCoreResponse,
  TipoAdjuntoCatalogItem,
  UpdateSolicitudCoreCancelacionRequest,
  UploadSolicitudCoreAdjuntoLoteItem,
  UploadSolicitudCoreAdjuntoRequest,
  WorkflowTransition,
} from "@/modules/solicitudes/types/solicitudes-core";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const AREA_ASSIGNMENT_REQUIRED_MESSAGE =
  "Tu cuenta no tiene un área asignada. Contactá a un administrador.";

function mapAreaForbiddenError(error: unknown) {
  if (error instanceof ApiError && error.status === 403) {
    return new ApiError(
      AREA_ASSIGNMENT_REQUIRED_MESSAGE,
      403,
      error.cause,
      error.rawBody,
    );
  }

  return error;
}

async function withAreaForbiddenMessage<T>(request: Promise<T>) {
  try {
    return await request;
  } catch (error) {
    throw mapAreaForbiddenError(error);
  }
}

export function createSolicitudCore(payload: CreateSolicitudCoreRequest) {
  return withAreaForbiddenMessage(
    apiClient.post<CreateSolicitudCoreResponse>("/solicitudes", payload),
  );
}

function withQuery(
  url: string,
  params: Record<string, number | string | undefined>,
) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") {
      continue;
    }

    searchParams.set(key, String(value));
  }

  return `${url}?${searchParams.toString()}`;
}

export function listSolicitudesCore(query: ListSolicitudesCoreQuery) {
  const request = apiClient.get<SolicitudCoreListItem[]>(
    withQuery("/solicitudes", query),
  );

  return query.scope === "tracking"
    ? request
    : withAreaForbiddenMessage(request);
}

export function getSolicitudCoreById(solicitudId: string) {
  return apiClient.get<SolicitudCoreResponse>(`/solicitudes/${solicitudId}`);
}

export function patchSolicitudCore(
  solicitudId: string,
  payload: PatchSolicitudCoreRequest,
) {
  return withAreaForbiddenMessage(
    apiClient.patch<SolicitudCoreResponse>(
      `/solicitudes/${solicitudId}`,
      payload,
    ),
  );
}

export function assignSolicitudToSelf(solicitudId: string) {
  return withAreaForbiddenMessage(
    apiClient.post<SolicitudCoreResponse>(
      `/solicitudes/${solicitudId}/assignment/self`,
      {},
    ),
  );
}

export function assignSolicitudToUser(
  solicitudId: string,
  targetUserId: string,
) {
  return withAreaForbiddenMessage(
    apiClient.post<SolicitudCoreResponse>(
      `/solicitudes/${solicitudId}/assignment`,
      { targetUserId },
    ),
  );
}

export function createPrestamoLegacy(solicitudId: string) {
  return withAreaForbiddenMessage(
    apiClient.post<SolicitudCoreResponse>(
      `/solicitudes/${solicitudId}/prestamo-legacy`,
      {},
    ),
  );
}

export function listSolicitudAssignableAgents(solicitudId: string) {
  return withAreaForbiddenMessage(
    apiClient.get<SolicitudCoreAssignableAgent[]>(
      `/solicitudes/${solicitudId}/assignment/agents`,
    ),
  );
}

export function listSolicitudCoreTransitions(solicitudId: string) {
  return withAreaForbiddenMessage(
    apiClient.get<WorkflowTransition[]>(
      `/solicitudes/${solicitudId}/transitions`,
    ),
  );
}

export function executeSolicitudCoreTransition(
  solicitudId: string,
  payload: ExecuteWorkflowTransitionRequest,
) {
  const requestBody: ExecuteWorkflowTransitionRequest = {
    actionCode: payload.actionCode,
  };

  if (payload.comment !== undefined) {
    requestBody.comment = payload.comment;
  }

  if (payload.reason !== undefined) {
    requestBody.reason = payload.reason;
  }

  return withAreaForbiddenMessage(
    apiClient.post<ExecuteWorkflowTransitionResponse>(
      `/solicitudes/${solicitudId}/transitions`,
      requestBody,
    ),
  );
}

export function listSolicitudCoreHistory(solicitudId: string) {
  return apiClient.get<SolicitudCoreWorkflowHistoryItem[]>(
    `/solicitudes/${solicitudId}/history`,
  );
}

function resolveErrorMessage(responseText: string) {
  if (!responseText) {
    return "No se pudo completar la solicitud.";
  }

  try {
    const parsed = JSON.parse(responseText) as {
      error?: { message?: string };
      message?: string;
    };
    return parsed.error?.message ?? parsed.message ?? responseText;
  } catch {
    return responseText;
  }
}

export function listSolicitudCoreAdjuntos(solicitudId: string) {
  return apiClient.get<SolicitudCoreAdjuntoResponse[]>(
    `/solicitudes/${solicitudId}/adjuntos`,
  );
}

export function deleteSolicitudCoreAdjunto(
  solicitudId: string,
  adjuntoId: string,
) {
  return apiClient.delete<void>(
    `/solicitudes/${solicitudId}/adjuntos/${adjuntoId}`,
  );
}

export function patchSolicitudCoreAdjunto(
  solicitudId: string,
  adjuntoId: string,
  payload: PatchSolicitudCoreAdjuntoRequest,
) {
  return withAreaForbiddenMessage(
    apiClient.patch<SolicitudCoreAdjuntoResponse>(
      `/solicitudes/${solicitudId}/adjuntos/${adjuntoId}`,
      payload,
    ),
  );
}

export function listSolicitudCoreCancelaciones(solicitudId: string) {
  return apiClient.get<SolicitudCoreCancelacionResponse[]>(
    `/solicitudes/${solicitudId}/cancelaciones`,
  );
}

export function createSolicitudCoreCancelacion(
  solicitudId: string,
  payload: CreateSolicitudCoreCancelacionRequest,
) {
  return withAreaForbiddenMessage(
    apiClient.post<SolicitudCoreCancelacionResponse>(
      `/solicitudes/${solicitudId}/cancelaciones`,
      payload,
    ),
  );
}

export function updateSolicitudCoreCancelacion(
  solicitudId: string,
  cancelacionId: string,
  payload: UpdateSolicitudCoreCancelacionRequest,
) {
  return withAreaForbiddenMessage(
    apiClient.patch<SolicitudCoreCancelacionResponse>(
      `/solicitudes/${solicitudId}/cancelaciones/${cancelacionId}`,
      payload,
    ),
  );
}

export function deleteSolicitudCoreCancelacion(
  solicitudId: string,
  cancelacionId: string,
) {
  return withAreaForbiddenMessage(
    apiClient.delete<void>(
      `/solicitudes/${solicitudId}/cancelaciones/${cancelacionId}`,
    ),
  );
}

function decodeContentDispositionFileName(value: string) {
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);

  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const asciiMatch = value.match(/filename="([^"]+)"/i);

  if (asciiMatch?.[1]) {
    return asciiMatch[1];
  }

  const unquotedMatch = value.match(/filename=([^;]+)/i);

  return unquotedMatch?.[1]?.trim() ?? null;
}

export async function downloadSolicitudCoreAdjunto(
  solicitudId: string,
  adjuntoId: string,
): Promise<DownloadSolicitudCoreAdjuntoResponse> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    DEFAULT_HTTP_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      new URL(
        `/solicitudes/${solicitudId}/adjuntos/${adjuntoId}/download`,
        API_BASE_URL,
      ),
      {
        credentials: "include",
        method: "GET",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const responseText = await response.text();
      throw new ApiError(resolveErrorMessage(responseText), response.status);
    }

    const fileNameHeader = response.headers.get("content-disposition");

    return {
      blob: await response.blob(),
      contentType: response.headers.get("content-type"),
      fileName: fileNameHeader
        ? decodeContentDispositionFileName(fileNameHeader)
        : null,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("La solicitud excedio el tiempo limite.");
    }

    throw new ApiError("No se pudo conectar con el backend.", undefined, error);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function uploadSolicitudCoreAdjunto(
  solicitudId: string,
  payload: UploadSolicitudCoreAdjuntoRequest,
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
) {
  const formData = new FormData();

  formData.set("file", payload.file);

  if (payload.tipoAdjunto) {
    formData.set("tipoAdjunto", payload.tipoAdjunto);
  }
  if (payload.descripcion) {
    formData.set("descripcion", payload.descripcion);
  }
  if (payload.adicional) {
    formData.set("adicional", payload.adicional);
  }
  if (payload.comentario) {
    formData.set("comentario", payload.comentario);
  }
  if (payload.nroDocumento) {
    formData.set("nroDocumento", payload.nroDocumento);
  }
  if (payload.restringido !== undefined) {
    formData.set("restringido", String(payload.restringido));
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      new URL(`/solicitudes/${solicitudId}/adjuntos`, API_BASE_URL),
      {
        body: formData,
        credentials: "include",
        method: "POST",
        signal: controller.signal,
      },
    );
    const responseText = await response.text();

    if (!response.ok) {
      throw new ApiError(resolveErrorMessage(responseText), response.status);
    }

    if (!responseText) {
      throw new ApiError(
        "La respuesta del servidor está vacía.",
        response.status,
      );
    }

    return JSON.parse(responseText) as SolicitudCoreAdjuntoResponse;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("La solicitud excedio el tiempo limite.");
    }

    throw new ApiError("No se pudo conectar con el backend.", undefined, error);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function listTiposAdjunto() {
  return apiClient.get<TipoAdjuntoCatalogItem[]>("/solicitudes/tipos-adjunto");
}

export async function uploadSolicitudCoreAdjuntosLote(
  solicitudId: string,
  items: UploadSolicitudCoreAdjuntoLoteItem[],
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
) {
  const formData = new FormData();
  const metadata = items.map((item) => ({
    adicional: item.adicional,
    comentario: item.comentario,
    descripcion: item.descripcion,
    nroDocumento: item.nroDocumento,
    restringido: item.restringido,
    tipoAdjunto: item.tipoAdjunto,
  }));

  for (const item of items) {
    formData.append("files", item.file);
  }
  formData.set("metadata", JSON.stringify(metadata));

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      new URL(`/solicitudes/${solicitudId}/adjuntos/batch`, API_BASE_URL),
      {
        body: formData,
        credentials: "include",
        method: "POST",
        signal: controller.signal,
      },
    );
    const responseText = await response.text();

    if (!response.ok) {
      throw new ApiError(resolveErrorMessage(responseText), response.status);
    }

    if (!responseText) {
      throw new ApiError(
        "La respuesta del servidor está vacía.",
        response.status,
      );
    }

    return JSON.parse(responseText) as SolicitudCoreAdjuntoResponse[];
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("La solicitud excedio el tiempo limite.");
    }

    throw new ApiError("No se pudo conectar con el backend.", undefined, error);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function simularPrestamo(payload: SimularPrestamoRequest) {
  return withAreaForbiddenMessage(
    apiClient.post<SimulacionPrestamoResponse>(
      "/solicitudes/simulacion",
      payload,
    ),
  );
}
