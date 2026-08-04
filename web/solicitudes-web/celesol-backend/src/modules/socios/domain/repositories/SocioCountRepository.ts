/**
 * Interfaz separada de `SocioRepository` a propósito: contar el total de
 * socios que matchean un filtro es una operación que solo necesita el listado
 * paginado (`ListSociosUseCase`), y sumarla directo a `SocioRepository`
 * obligaría a actualizar cada fake/mock de esa interfaz en todo el backend
 * (docenas de archivos de test en otros módulos que no tienen nada que ver
 * con paginación de socios).
 */
export interface SocioCountRepository {
  count(input: { search?: string }): Promise<number>;
}
