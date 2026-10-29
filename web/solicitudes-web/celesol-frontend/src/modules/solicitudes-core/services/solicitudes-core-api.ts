import type { ConvenioSocioRequest } from "../utils/convenio-edicion";
import { apiClient, fetchConSesion } from "@/shared/services/http/api-client";
import { ApiError } from "@/shared/services/http/api-error";
import { DEFAULT_HTTP_TIMEOUT_MS } from "@/shared/services/http/http.constants";
import type { LineaPrestamoPresolicitud } from "@/modules/solicitudes/types/solicitudes";

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

// Lineas del agente del vendedor de la solicitud: las que se le pueden
// asignar, sin importar quien la este mirando.
export function getSolicitudCoreLineasPrestamo(solicitudId: string) {
  return withAreaForbiddenMessage(
    apiClient.get<LineaPrestamoPresolicitud[]>(
      `/solicitudes/${solicitudId}/lineas-prestamo`,
    ),
  );
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

export type { ConvenioSocioRequest } from "../utils/convenio-edicion";

export function createPrestamoLegacy(
  solicitudId: string,
  convenio?: ConvenioSocioRequest,
) {
  return withAreaForbiddenMessage(
    apiClient.post<SolicitudCoreResponse>(
      `/solicitudes/${solicitudId}/prestamo-legacy`,
      convenio ? { convenio } : {},
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

export type CredixsaInformeResponse = {
  cachedAt: string;
  cacheHit: boolean;
  cuit: string;
  error: string;
  /** El informe normalizado: persona, bcra, previsional, aportes, quiebras, alertas. */
  informe: unknown;
  nombre: string;
  ok: boolean;
  status: string;
};

// El timeout por defecto del cliente son 15 segundos y esta consulta no entra
// ahi: Kestra levanta un contenedor por tarea, asi que tarda entre 15 y 120
// segundos incluso con el informe cacheado. Con el default, el navegador
// cortaba antes de que respondiera y la pestaña mostraba "no se pudo
// consultar" mientras la ejecucion terminaba bien en Kestra.
const CREDIXSA_TIMEOUT_MS = 180000;

export function getCredixsaSolicitud(solicitudId: string) {
  return apiClient.get<{ credixsa: CredixsaInformeResponse | null }>(
    `/solicitudes/${solicitudId}/credixsa`,
    CREDIXSA_TIMEOUT_MS,
  );
}

export type PrestamoDelSocioResponse = {
  estado: number | null;
  capital: number | null;
  fechaEmision: string | null;
  legacyId: string | null;
  lineaPrestamoDescripcion: string | null;
  montoADesembolsar: number | null;
  montoPrestamo: number | null;
  nroCuenta: string | null;
  primerVencimiento: string | null;
  saldo: number | null;
  vencimiento: string | null;
  vigente: boolean | null;
};

export function listPrestamosDelSocio(solicitudId: string) {
  return apiClient.get<{ prestamos: PrestamoDelSocioResponse[] }>(
    `/solicitudes/${solicitudId}/prestamos-socio`,
  );
}

export type PrestamoDelSocioDetalleResponse = {
  cuotas: number | null;
  asiento: string | null;
  cobrador: string | null;
  destino: string | null;
  legacyId: string | null;
  lineaPrestamoDescripcion: string | null;
  nroCuenta: string | null;
  ordenCompra: string | null;
  /** Fraccion (0.1135), no porcentaje. */
  tasaInicial: number | null;
};

export type CuotaPrestamoResponse = {
  capital: number | null;
  fecha: string | null;
  /** null/vacío: sin cobro; ausente: dato no disponible. */
  fechaCobro?: string | null;
  montoTotal: number | null;
  nroCuota: number | null;
  saldoCuota: number | null;
  saldoCuotaConPunitorios: number | null;
};

export function getPrestamoDelSocio(solicitudId: string, prestamoId: string) {
  return apiClient.get<{
    cuotas: CuotaPrestamoResponse[];
    prestamo: PrestamoDelSocioDetalleResponse;
  }>(`/solicitudes/${solicitudId}/prestamos-socio/${prestamoId}`);
}

export type RefinanciacionPrestamoRequest = {
  nrosCuota: number[];
  /** ID del prestamo en Vimarx (legacyId). */
  prestamoId: string;
};

export type RefinanciacionCuotaSimulada = {
  fechaVto: string | null;
  interesPagado: number;
  nroCuota: number;
  otrosPagado: number;
  punitoriosPagados: number;
  totalPagado: number;
};

export type RefinanciacionPrestamoSimulado =
  | {
      cuotas: RefinanciacionCuotaSimulada[];
      ok: true;
      otros: number;
      prestamoId: string;
      punitorios: number;
      totalPago: number;
    }
  | { error: string; ok: false; prestamoId: string };

export type RefinanciacionSimuladaResponse = {
  prestamos: RefinanciacionPrestamoSimulado[];
  /** null si algun prestamo no se pudo simular. */
  total: number | null;
};

export type SolicitudRefinanciacionResponse = {
  prestamos: (RefinanciacionPrestamoRequest & {
    /**
     * Cobros en Vimarx al generar el prestamo: uno o dos por prestamo (las
     * vencidas aparte). Vacia mientras no se cobro nada.
     */
    cobros?: {
      cobradoAt: string;
      cobroId: string;
      nrosCuota: number[];
      totalCobrado: number;
    }[];
  })[];
  updatedAt: string | null;
};

export function getSolicitudRefinanciacion(solicitudId: string) {
  return apiClient.get<SolicitudRefinanciacionResponse>(
    `/solicitudes/${solicitudId}/refinanciacion`,
  );
}

// Vimarx calcula el importe de cada cuota a la fecha de hoy, sin guardar nada.
export function simularRefinanciacion(
  solicitudId: string,
  prestamos: RefinanciacionPrestamoRequest[],
) {
  return apiClient.post<RefinanciacionSimuladaResponse>(
    `/solicitudes/${solicitudId}/refinanciacion/simulacion`,
    { prestamos },
  );
}

// La simulacion en PDF, con "SIMULACION" cruzado, para mostrarle al socio.
export async function descargarSimulacionRefinanciacionPdf(
  solicitudId: string,
  prestamos: RefinanciacionPrestamoRequest[],
): Promise<Blob> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    DEFAULT_HTTP_TIMEOUT_MS,
  );

  try {
    const response = await fetchConSesion(
      `/solicitudes/${solicitudId}/refinanciacion/simulacion/pdf`,
      {
        body: JSON.stringify({ prestamos }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const responseText = await response.text();
      throw new ApiError(resolveErrorMessage(responseText), response.status);
    }

    return await response.blob();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// Guarda las cuotas y deja el comprobante en los adjuntos de la solicitud.
// Sin cuotas, quita la refinanciacion y su comprobante.
export function generarComprobanteRefinanciacion(
  solicitudId: string,
  prestamos: RefinanciacionPrestamoRequest[],
) {
  return withAreaForbiddenMessage(
    apiClient.post<
      SolicitudRefinanciacionResponse & {
        adjuntoId: string | null;
        simulacion: RefinanciacionSimuladaResponse | null;
      }
    >(`/solicitudes/${solicitudId}/refinanciacion/comprobante`, { prestamos }),
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
  signal?: AbortSignal,
): Promise<DownloadSolicitudCoreAdjuntoResponse> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    DEFAULT_HTTP_TIMEOUT_MS,
  );

  try {
    const response = await fetchConSesion(
      `/solicitudes/${solicitudId}/adjuntos/${adjuntoId}/download`,
      {
        method: "GET",
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
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
    const response = await fetchConSesion(
      `/solicitudes/${solicitudId}/adjuntos`,
      {
        body: formData,
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
    const response = await fetchConSesion(
      `/solicitudes/${solicitudId}/adjuntos/batch`,
      {
        body: formData,
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

export function simularPrestamo(input: SimularPrestamoRequest) {
  const { solicitudId, ...payload } = input;
  return withAreaForbiddenMessage(
    apiClient.post<SimulacionPrestamoResponse>(
      solicitudId ? `/solicitudes/${solicitudId}/simulacion` : "/solicitudes/simulacion",
      payload,
    ),
  );
}

export type SolicitudDelTitular = {
  nroSolicitud: string | null;
  fecha: string | null;
  estado: string | null;
  vendedor: string | null;
  usuarioCreador: string | null;
  linea: string | null;
  montoAFinanciar: number | null;
  montoADesembolsar: number | null;
  cuotas: number | null;
  cuotaResultante: number | null;
  nroCuentaPrestamo: string | null;
  nroSocio: string | null;
  nroDocumento: string | null;
  nombreCompleto: string | null;
};


export type HistorialSolicitudesResponse = {
 status: "ok" | "documento_invalido";
 solicitudes: SolicitudDelTitular[];
 limit: 50;
};
export function listSolicitudesDelTitular(id: string) {
 return apiClient.get<HistorialSolicitudesResponse>(`/solicitudes/${id}/solicitudes-titular`);
}

export type RevisionPrestamoResponse = {
  titular: { nombreCompleto: string | null; nroSocio: string | null };
  // SocAux del socio en Vimarx (Mudon = beneficio, AMEJUCA = convAux) y sus
  // observaciones. null si no hay socio o Vimarx no respondio.
  convenio: {
    beneficio: string | null; caja40: number | null;
    convAux: number | null; observaciones: string | null;
  } | null;
  condiciones: { lineaDescripcion: string; montoAFinanciar: number | null; cuotas: number | null };
  calculo: {
    capital: number | null; cuotaResultante: number | null; cuotas: number | null;
    gastos: number | null; tasa: number | null; total: number | null;
    fechaPrimerVencimiento: string | null; fechaUltimaCuota: string | null;
    cuotasDetalle: {
      capital: number | null; fechaVencimiento: string | null; gastos: number | null;
      interes: number | null; numeroCuota: number | null; total: number | null;
    }[] | null;
  } | null;
};

export function getRevisionPrestamo(solicitudId: string) {
  return withAreaForbiddenMessage(apiClient.get<RevisionPrestamoResponse>(
    `/solicitudes/${solicitudId}/revision-prestamo`,
  ));
}
