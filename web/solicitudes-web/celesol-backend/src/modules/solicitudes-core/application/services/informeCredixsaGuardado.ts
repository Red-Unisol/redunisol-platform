import type { InformeCredixsaGuardado } from "../../domain/repositories/SolicitudCredixsaInformeRepository";
import type { InformeCredixsa } from "../../infrastructure/services/ConsultarCredixsaGateway";

/**
 * Cuanto sirve un informe guardado antes de volver a consultar. Es la misma
 * vigencia que la cache de Kestra (CACHE_MAX_AGE_DAYS en consulta_quiebra_credix)
 * y se cuenta desde el mismo momento, asi que cuando vence el nuestro tambien
 * vencio aquel y la consulta nueva trae datos frescos de CredixSA.
 */
export const VIGENCIA_INFORME_CREDIXSA_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Lo que se guarda de una respuesta de Kestra, o null si no hay nada que
 * guardar. Solo se guarda un informe que la pestaña pueda mostrar: un "no se
 * pudo consultar" o un "sin resultados" se vuelve a intentar la proxima vez.
 */
export function paraGuardar(
  informe: InformeCredixsa | null,
  ahora: Date,
): InformeCredixsaGuardado | null {
  if (!informe?.ok || !informe.informe || typeof informe.informe !== "object") {
    return null;
  }

  return {
    // La fecha en que CredixSA genero el informe, que en un acierto de cache
    // puede ser de dias atras. Guardar la de hoy lo haria parecer mas fresco.
    consultadoEn: parsearFecha(informe.cachedAt) ?? ahora,
    cuit: informe.cuit,
    informe: informe.informe,
    nombre: informe.nombre,
    status: informe.status,
  };
}

export function estaVigente(guardado: InformeCredixsaGuardado, ahora: Date) {
  return (
    ahora.getTime() - guardado.consultadoEn.getTime() <
    VIGENCIA_INFORME_CREDIXSA_MS
  );
}

/**
 * El informe guardado con la misma forma que la respuesta de Kestra, para que
 * la pestaña no tenga que distinguir de donde viene. cacheHit en true hace que
 * muestre la fecha del informe en vez de "consultado recien".
 */
export function desdeGuardado(guardado: InformeCredixsaGuardado): InformeCredixsa {
  return {
    cachedAt: guardado.consultadoEn.toISOString(),
    cacheHit: true,
    cuit: guardado.cuit,
    error: "",
    informe: guardado.informe,
    nombre: guardado.nombre,
    ok: true,
    status: guardado.status,
  };
}

function parsearFecha(value: string): Date | null {
  if (!value.trim()) {
    return null;
  }

  const fecha = new Date(value);

  return Number.isNaN(fecha.getTime()) ? null : fecha;
}
