import { createHash } from "node:crypto";

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
  /**
   * Fecha de calculo "YYYY-MM-DD" con la que Vimarx calcula el cobro (el
   * "utiliza fecha calculo" de la pantalla). null = el dia en que se cobra.
   */
  fechaCalculo?: string | null;
  prestamos: SolicitudRefinanciacionPrestamoGuardado[];
  /** Ultimo guardado; null si nunca se cargo. */
  updatedAt: Date | null;
};

export interface SolicitudRefinanciacionRepository {
  findBySolicitudId(solicitudId: string): Promise<SolicitudRefinanciacion>;
  /** Reemplaza la seleccion entera; una lista vacia la borra. */
  replace(input: {
    expectedSolicitudUpdatedAt: Date;
    expectedVersion: string;
    fechaCalculo?: string | null;
    prestamos: SolicitudRefinanciacionPrestamo[];
    solicitudId: string;
    updatedBy: string;
  }): Promise<SolicitudRefinanciacion>;
}

/** Includes confirmed charges and row revisions, even when the selection is unchanged. */
export function refinanciacionVersion(value: SolicitudRefinanciacion) {
  return createHash("sha256").update(JSON.stringify({
    // Solo si hay una: asi las versiones sin fecha no cambian.
    ...(value.fechaCalculo ? { fechaCalculo: value.fechaCalculo } : {}),
    updatedAt: value.updatedAt?.toISOString() ?? null,
    prestamos: [...value.prestamos].sort((a, b) => a.prestamoId.localeCompare(b.prestamoId)).map(p => ({
      prestamoId: p.prestamoId, nrosCuota: [...p.nrosCuota].sort((a, b) => a - b),
      cobros: p.cobros.map(c => [c.cobroId, c.totalCobrado, [...c.nrosCuota].sort((a, b) => a - b)]),
    })),
  })).digest("hex");
}

/** Cuotas elegidas que todavia no se cobraron en Vimarx. */
export function cuotasPendientesDeCobro(
  prestamo: SolicitudRefinanciacionPrestamoGuardado,
) {
  const cobradas = new Set(prestamo.cobros.flatMap((cobro) => cobro.nrosCuota));

  return prestamo.nrosCuota.filter((nro) => !cobradas.has(nro));
}
