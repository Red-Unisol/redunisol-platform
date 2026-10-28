export type SolicitudRefinanciacionPrestamo = {
  nrosCuota: number[];
  /** ID del prestamo en Vimarx. */
  prestamoId: string;
};

export type SolicitudRefinanciacionCobro = {
  cobradoAt: Date;
  /** ID de la fila de pago en Vimarx (CuotaPrestamo "PG ..."). */
  cobroId: string;
  /** Cuotas que cancelo este cobro. */
  nrosCuota: number[];
  totalCobrado: number;
};

export type SolicitudRefinanciacionPrestamoGuardado =
  SolicitudRefinanciacionPrestamo & {
    /**
     * Cobros en Vimarx de este prestamo: uno o dos (las vencidas aparte).
     * Vacia mientras no se cobro nada.
     */
    cobros: SolicitudRefinanciacionCobro[];
  };

export type SolicitudRefinanciacion = {
  prestamos: SolicitudRefinanciacionPrestamoGuardado[];
  /** Ultimo guardado; null si nunca se cargo. */
  updatedAt: Date | null;
};

export interface SolicitudRefinanciacionRepository {
  /** Registra un cobro en Vimarx de cuotas de un prestamo. */
  agregarCobro(input: {
    cobro: Omit<SolicitudRefinanciacionCobro, "cobradoAt">;
    prestamoId: string;
    solicitudId: string;
  }): Promise<void>;
  findBySolicitudId(solicitudId: string): Promise<SolicitudRefinanciacion>;
  /** Reemplaza la seleccion entera; una lista vacia la borra. */
  replace(input: {
    prestamos: SolicitudRefinanciacionPrestamo[];
    solicitudId: string;
    updatedBy: string;
  }): Promise<SolicitudRefinanciacion>;
}

/** Cuotas elegidas que todavia no se cobraron en Vimarx. */
export function cuotasPendientesDeCobro(
  prestamo: SolicitudRefinanciacionPrestamoGuardado,
) {
  const cobradas = new Set(prestamo.cobros.flatMap((cobro) => cobro.nrosCuota));

  return prestamo.nrosCuota.filter((nro) => !cobradas.has(nro));
}
