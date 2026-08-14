import type { MappedSocioRow } from "../../application/services/ClassifySocioMutualRow";

/**
 * Interfaz separada de `SocioRepository` a propósito: sincronizar en bloque
 * desde el legado (Vimax) es una operación distinta de las operaciones CRUD
 * de a un socio por vez, y sumarla directo a `SocioRepository` obligaría a
 * actualizar cada fake/mock de esa interfaz en todo el backend (docenas de
 * archivos de test que no tienen nada que ver con esta funcionalidad).
 */
export interface SocioLegacySyncRepository {
  /**
   * Inserta socios nuevos y actualiza los existentes (por cuit) con los
   * campos que vienen de Vimax, sin tocar domicilio, id ni created_at.
   * Devuelve la cantidad total de filas escritas (insert + update).
   */
  upsertManyFromLegacy(rows: MappedSocioRow[]): Promise<number>;
}
