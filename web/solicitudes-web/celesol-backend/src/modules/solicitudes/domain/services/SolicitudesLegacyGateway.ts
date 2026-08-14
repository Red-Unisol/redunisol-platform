import type {
  LineaPrestamoPresolicitud,
  PrestamoOtorgadoLegacy,
  SocioMutualCancelacionDetalle,
  SocioMutualCancelacionListItem,
  SocioMutualLegacy,
  SolicitudDetalleLegacy,
  SolicitudDetail,
  SolicitudPrecargaItem,
  SolicitudRecienteItem,
} from "../entities/Solicitud.entity";

export type SolicitudesLegacyGateway = {
  getDetalleByNroSolicitud(
    nroSolicitud: string,
  ): Promise<SolicitudDetalleLegacy[]>;
  getDetailByOid(oid: string): Promise<SolicitudDetail[]>;
  getHistoricas(
    legacyUser: string,
    max: number,
  ): Promise<SolicitudRecienteItem[]>;
  getLegacyUserId(legacyUser: string): Promise<number | null>;
  getLineasPrestamoByLegacyUser(
    legacyUser: string,
  ): Promise<LineaPrestamoPresolicitud[]>;
  getPrecarga(
    legacyUser: string,
    max: number,
  ): Promise<SolicitudPrecargaItem[]>;
  getPrestamoOtorgadoByLegacyOid(
    legacyOid: string,
  ): Promise<PrestamoOtorgadoLegacy | null>;
  getRecientes(
    legacyUser: string,
    max: number,
  ): Promise<SolicitudRecienteItem[]>;
  getSocioByDni(dni: string): Promise<SocioMutualLegacy[]>;
  getSocioMutualCancelacionDetalleById(
    id: string,
  ): Promise<SocioMutualCancelacionDetalle | null>;
  getVendedorLegacyId(legacyUser: string): Promise<number | null>;
  listSociosCancelaciones(): Promise<SocioMutualCancelacionListItem[]>;
};
