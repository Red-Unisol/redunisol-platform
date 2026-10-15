/**
 * Estados en los que la solicitud termino mal. Al entrar a cualquiera de
 * ellos se borra el informe de CredixSA guardado: ya no hay credito que
 * evaluar, y es informacion crediticia de una persona que no hace falta
 * conservar.
 *
 * Los tres son finales (no tienen transiciones de salida), asi que alcanza
 * con borrar al entrar: la solicitud no vuelve a un estado que lo necesite.
 */
export const ESTADOS_QUE_BORRAN_INFORME_CREDIXSA: readonly string[] = [
  "Desestimada",
  "Rechazada",
  "Vencida",
];

export type InformeCredixsaGuardado = {
  /** Cuando CredixSA genero el informe, no cuando lo guardamos nosotros. */
  consultadoEn: Date;
  cuit: string;
  /** El informe normalizado: persona, bcra, previsional, aportes, quiebras, alertas. */
  informe: unknown;
  nombre: string;
  status: string;
};

export type SolicitudCredixsaInformeRepository = {
  findBySolicitudId(solicitudId: string): Promise<InformeCredixsaGuardado | null>;
  /**
   * Crea o pisa el informe de la solicitud. No guarda nada si la solicitud
   * esta en uno de ESTADOS_QUE_BORRAN_INFORME_CREDIXSA.
   */
  guardar(solicitudId: string, informe: InformeCredixsaGuardado): Promise<void>;
};
