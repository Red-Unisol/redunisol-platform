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
    prestamos: SolicitudRefinanciacionPrestamo[];
    solicitudId: string;
    updatedBy: string;
  }): Promise<SolicitudRefinanciacion>;
}

/** Includes confirmed charges and row revisions, even when the selection is unchanged. */
export function refinanciacionVersion(value: SolicitudRefinanciacion) {
  return createHash("sha256").update(JSON.stringify({
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
