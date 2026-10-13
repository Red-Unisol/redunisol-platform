import type { SolicitudCoreAdjuntoResponse } from "@/modules/solicitudes/types/solicitudes-core";
export function getRecibosDeSolicitud(
  adjuntos: SolicitudCoreAdjuntoResponse[],
  solicitudId: string,
) {
  return adjuntos.filter(
    (item) =>
      item.solicitudId === solicitudId &&
      item.tipoAdjunto === "Recibo de Sueldo" &&
      !item.deletedAt,
  );
}
