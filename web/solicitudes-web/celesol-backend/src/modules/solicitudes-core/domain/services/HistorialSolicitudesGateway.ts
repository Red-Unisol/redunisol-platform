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

export interface HistorialSolicitudesGateway {
  listSolicitudesDelTitular(documento: string): Promise<SolicitudDelTitular[]>;
}
