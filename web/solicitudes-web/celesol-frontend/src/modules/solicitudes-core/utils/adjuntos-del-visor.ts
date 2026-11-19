import type { SolicitudCoreAdjuntoResponse } from "@/modules/solicitudes/types/solicitudes-core";
import { getRecibosDeSolicitud } from "./recibos-de-solicitud";

export const TIPO_DOCUMENTACION_ADICIONAL = "Documentación Adicional";

// La evaluacion que guarda la calculadora al pedir generacion o liquidacion se
// archiva como Documentacion Adicional (.xlsx). No es documentacion del socio
// y el visor no puede mostrarla: queda fuera.
function esEvaluacionArchivada(adjunto: SolicitudCoreAdjuntoResponse) {
  return (
    /\/adjuntos\/evaluacion-[^/]+\.xlsx$/i.test(adjunto.archivoPath ?? "") ||
    /^Evaluacion-.*\.xlsx$/i.test(adjunto.archivoNombre ?? "")
  );
}

// Lo que se puede recorrer en el visor junto a la calculadora: primero los
// recibos de sueldo y despues la documentacion adicional, cada grupo en el
// orden del listado. Solo para el visor: el control de "falta el recibo" sigue
// usando getRecibosDeSolicitud.
export function getAdjuntosDelVisor(
  adjuntos: SolicitudCoreAdjuntoResponse[],
  solicitudId: string,
) {
  const documentacionAdicional = adjuntos.filter(
    (item) =>
      item.solicitudId === solicitudId &&
      item.tipoAdjunto === TIPO_DOCUMENTACION_ADICIONAL &&
      !item.deletedAt &&
      !esEvaluacionArchivada(item),
  );
  return [
    ...getRecibosDeSolicitud(adjuntos, solicitudId),
    ...documentacionAdicional,
  ];
}
