export type SolicitudRefinanciacionPrestamo = {
  nrosCuota: number[];
  /** ID del prestamo en Vimarx. */
  prestamoId: string;
};

export type SolicitudRefinanciacionCobro = {
  cobradoAt: Date;
  /** ID de la fila de pago en Vimarx (CuotaPrestamo "PG ..."). */
  cobroId: string;
  totalCobrado: number;
};

export type SolicitudRefinanciacionPrestamoGuardado =
  SolicitudRefinanciacionPrestamo & {
    /** null mientras no se cobro en Vimarx. */
    cobro: SolicitudRefinanciacionCobro | null;
  };

export type SolicitudRefinanciacion = {
  prestamos: SolicitudRefinanciacionPrestamoGuardado[];
  /** Ultimo guardado; null si nunca se cargo. */
  updatedAt: Date | null;
};

export interface SolicitudRefinanciacionRepository {
  findBySolicitudId(solicitudId: string): Promise<SolicitudRefinanciacion>;
  /** Registra el cobro en Vimarx de las cuotas de un prestamo. */
  marcarCobrado(input: {
    cobroId: string;
    prestamoId: string;
    solicitudId: string;
    totalCobrado: number;
  }): Promise<void>;
  /** Reemplaza la seleccion entera; una lista vacia la borra. */
  replace(input: {
    prestamos: SolicitudRefinanciacionPrestamo[];
    solicitudId: string;
    updatedBy: string;
  }): Promise<SolicitudRefinanciacion>;
}
