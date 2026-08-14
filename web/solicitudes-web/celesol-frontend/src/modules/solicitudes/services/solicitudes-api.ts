import { apiClient } from "@/shared/services/http/api-client";
import { ApiError } from "@/shared/services/http/api-error";

import type {
  LineaPrestamoPresolicitud,
  SocioMutualCancelacionDetalle,
  SocioMutualCancelacionListItem,
  SocioMutualLegacy,
  SolicitudDetalleLegacy,
  SolicitudDetail,
  SolicitudPrecargaItem,
  SolicitudRecienteItem,
} from "@/modules/solicitudes/types/solicitudes";

export const SOLICITUDES_PRECARGA_DEFAULT_MAX = 100;
export const SOLICITUDES_RECIENTES_DEFAULT_MAX = 100;
export const SOLICITUDES_HISTORICAS_DEFAULT_MAX = 90000;
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

type GetSolicitudesPrecargaOptions = {
  max?: number;
};

type GetSolicitudesRecientesOptions = {
  max?: number;
};

type GetSolicitudesHistoricasOptions = {
  max?: number;
};

function withQuery(url: string, params: Record<string, number | string>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    searchParams.set(key, String(value));
  }

  return `${url}?${searchParams.toString()}`;
}

export async function getSolicitudesPrecarga(
  options: GetSolicitudesPrecargaOptions = {},
) {
  return withAreaForbiddenMessage(
    apiClient.get<SolicitudPrecargaItem[]>(
      withQuery("/solicitudes-legacy/precarga", {
        max: options.max ?? SOLICITUDES_PRECARGA_DEFAULT_MAX,
      }),
    ),
  );
}

export async function getSolicitudesRecientes(
  options: GetSolicitudesRecientesOptions = {},
) {
  return withAreaForbiddenMessage(
    apiClient.get<SolicitudRecienteItem[]>(
      withQuery("/solicitudes-legacy/recientes", {
        max: options.max ?? SOLICITUDES_RECIENTES_DEFAULT_MAX,
      }),
    ),
  );
}

export async function getSolicitudesHistoricas(
  options: GetSolicitudesHistoricasOptions = {},
) {
  return withAreaForbiddenMessage(
    apiClient.get<SolicitudRecienteItem[]>(
      withQuery("/solicitudes-legacy/historicas", {
        max: options.max ?? SOLICITUDES_HISTORICAS_DEFAULT_MAX,
      }),
    ),
  );
}

export async function getSolicitudDetalleByNroSolicitud(nroSolicitud: string) {
  return withAreaForbiddenMessage(
    apiClient.get<SolicitudDetalleLegacy[]>(
      withQuery("/solicitudes-legacy/detalle", { nroSolicitud }),
    ),
  );
}

export async function getSolicitudDetailByOid(oid: string) {
  return withAreaForbiddenMessage(
    apiClient.get<SolicitudDetail>(
      withQuery("/solicitudes-legacy/detail", { oid }),
    ),
  );
}

export async function getSocioByDni(dni: string) {
  return withAreaForbiddenMessage(
    apiClient.get<SocioMutualLegacy[]>(
      withQuery("/solicitudes-legacy/socio", { dni }),
    ),
  );
}

export async function getLineasPrestamoByAgente() {
  return withAreaForbiddenMessage(
    apiClient.get<LineaPrestamoPresolicitud[]>(
      "/solicitudes-legacy/lineas-prestamo",
    ),
  );
}

export async function getSociosCancelaciones() {
  return withAreaForbiddenMessage(
    apiClient.get<SocioMutualCancelacionListItem[]>(
      "/solicitudes-legacy/socios-cancelaciones",
    ),
  );
}

export async function getSocioCancelacionDetalleById(id: string) {
  return withAreaForbiddenMessage(
    apiClient.get<SocioMutualCancelacionDetalle>(
      withQuery("/solicitudes-legacy/socios-cancelaciones/detalle", { id }),
    ),
  );
}
