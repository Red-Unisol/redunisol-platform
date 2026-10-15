import type { LineaPrestamoPresolicitud } from "../../../solicitudes/domain/entities/Solicitud.entity";

export type LegacyLineaPrestamo = {
  cantidadMaximaCuotas?: number | null;
  cantidadMinimaCuotas?: number | null;
  descripcion: string;
  legacyOid: string;
  montoMaximo?: number | null;
  montoMinimo?: number | null;
  vigente: boolean;
};

export type LineasPrestamoCatalog = {
  findByLegacyUserAndOid(
    legacyUser: string,
    oid: string,
  ): Promise<LegacyLineaPrestamo | null>;
  // Lineas vigentes del agente del usuario del legado, tal como las muestra
  // el formulario de carga.
  listVigentesByLegacyUser?(
    legacyUser: string,
  ): Promise<LineaPrestamoPresolicitud[]>;
};
