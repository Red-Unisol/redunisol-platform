export type SolicitudRefinanciacionPrestamo = {
  nrosCuota: number[];
  /** ID del prestamo en Vimarx. */
  prestamoId: string;
};

export type SolicitudRefinanciacion = {
  prestamos: SolicitudRefinanciacionPrestamo[];
  /** Ultimo guardado; null si nunca se cargo. */
  updatedAt: Date | null;
};

export interface SolicitudRefinanciacionRepository {
  findBySolicitudId(solicitudId: string): Promise<SolicitudRefinanciacion>;
  /** Reemplaza la seleccion entera; una lista vacia la borra. */
  replace(input: {
    prestamos: SolicitudRefinanciacionPrestamo[];
    solicitudId: string;
    updatedBy: string;
  }): Promise<SolicitudRefinanciacion>;
}
