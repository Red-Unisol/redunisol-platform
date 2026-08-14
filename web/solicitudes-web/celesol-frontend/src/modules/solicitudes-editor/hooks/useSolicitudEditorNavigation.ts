import { useMemo } from "react";

import {
  getSolicitudDetailOriginPath,
  normalizeSolicitudNumber,
} from "@/modules/solicitudes/utils/solicitud-detail-navigation";

export function useSolicitudEditorNavigation({
  detalleNroSolicitud,
  isDetailRoute,
  origen,
}: {
  detalleNroSolicitud: string;
  isDetailRoute: boolean;
  origen: string | null;
}) {
  const originPath = useMemo(
    () => getSolicitudDetailOriginPath(origen),
    [origen],
  );
  const detailTitle = useMemo(() => {
    const resolvedNroSolicitud = normalizeSolicitudNumber(detalleNroSolicitud);

    if (isDetailRoute && resolvedNroSolicitud) {
      return "Detalle de Solicitud " + resolvedNroSolicitud;
    }

    if (isDetailRoute) {
      return "Detalle de Solicitud";
    }

    return "Solicitud Nueva";
  }, [detalleNroSolicitud, isDetailRoute]);

  return { detailTitle, originPath };
}
