export type SolicitudDetailOrigin = "historicas" | "precarga" | "recientes";

type SolicitudDetailOriginConfig = {
  label: string;
  path: string;
  shortLabel: string;
};

const DETAIL_ORIGIN_CONFIG: Record<
  SolicitudDetailOrigin,
  SolicitudDetailOriginConfig
> = {
  historicas: {
    label: "Solicitudes Históricas",
    path: "/solicitudes/historicas",
    shortLabel: "Históricas",
  },
  precarga: {
    label: "Solicitudes Precarga",
    path: "/solicitudes/precarga",
    shortLabel: "Precarga",
  },
  recientes: {
    label: "Solicitudes Recientes",
    path: "/solicitudes/recientes",
    shortLabel: "Recientes",
  },
};

export function getSolicitudDetailOrigin(
  value: string | null | undefined,
): SolicitudDetailOrigin {
  // Antes "precarga" caía en Recientes: Atrás no volvía a Precarga.
  if (value === "historicas" || value === "precarga" || value === "recientes") {
    return value;
  }

  return "recientes";
}

export function getSolicitudDetailOriginLabel(
  value: string | null | undefined,
) {
  return DETAIL_ORIGIN_CONFIG[getSolicitudDetailOrigin(value)].label;
}

export function getSolicitudDetailOriginPath(value: string | null | undefined) {
  return DETAIL_ORIGIN_CONFIG[getSolicitudDetailOrigin(value)].path;
}

const CORE_DETAIL_ORIGIN_CONFIG: Record<
  SolicitudDetailOrigin,
  SolicitudDetailOriginConfig
> = {
  historicas: {
    label: "Solicitudes Históricas",
    path: "/solicitudes/core/historicas",
    shortLabel: "Históricas",
  },
  precarga: {
    label: "Solicitudes Precarga",
    path: "/solicitudes/core/precarga",
    shortLabel: "Precarga",
  },
  recientes: {
    label: "Solicitudes Recientes",
    path: "/solicitudes/core/recientes",
    shortLabel: "Recientes",
  },
};

// Para el enlace "← Precarga" de la barra superior en el detalle.
export function getSolicitudCoreDetailOriginLink(
  value: string | null | undefined,
) {
  const config = CORE_DETAIL_ORIGIN_CONFIG[getSolicitudDetailOrigin(value)];
  return { label: config.shortLabel, to: config.path };
}

export function getSolicitudCoreDetailOriginLabel(
  value: string | null | undefined,
) {
  return CORE_DETAIL_ORIGIN_CONFIG[getSolicitudDetailOrigin(value)].label;
}

export function getSolicitudCoreDetailOriginPath(
  value: string | null | undefined,
) {
  return CORE_DETAIL_ORIGIN_CONFIG[getSolicitudDetailOrigin(value)].path;
}

export function normalizeSolicitudNumber(value: string | null | undefined) {
  const normalizedValue = value?.trim();

  if (!normalizedValue || normalizedValue === "0") {
    return null;
  }

  return normalizedValue;
}

export function buildSolicitudDetailTitle(
  _origin: string | null | undefined,
  nroSolicitud: string | null | undefined,
) {
  const resolvedNroSolicitud = normalizeSolicitudNumber(nroSolicitud);

  if (!resolvedNroSolicitud) {
    return "Detalle de Solicitud";
  }

  return `Detalle de Solicitud ${resolvedNroSolicitud}`;
}
