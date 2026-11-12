import { InvalidSolicitudesCoreRequestError } from "../../domain/solicitudes-core-errors";
import type { LocalidadCatalog } from "../../domain/services/LocalidadCatalog";

export type TitularLocalidad = {
  localidad: string | null;
  localidadId: string | null;
};

/**
 * La localidad del titular se elige por su ID de Vimarx: es el dato que usa
 * el alta del socio. El nombre lo copia el backend desde Vimarx, para mostrar
 * e imprimir (firma, comprobante, finalizar); el cliente no lo escribe.
 *
 * - `undefined`: el pedido no toca la localidad.
 * - `null`: se quita (ID y nombre).
 * - un ID: tiene que existir en Vimarx.
 */
export async function resolveTitularLocalidad(
  catalog: LocalidadCatalog | undefined,
  localidadId: string | null | undefined,
): Promise<TitularLocalidad | undefined> {
  if (localidadId === undefined) {
    return undefined;
  }

  if (localidadId === null) {
    return { localidad: null, localidadId: null };
  }

  if (!catalog) {
    throw new Error("Falta configurar el catalogo de localidades.");
  }

  const localidad = await catalog.findById(localidadId);

  if (!localidad) {
    throw new InvalidSolicitudesCoreRequestError(
      "La localidad elegida no existe en Vimarx. Buscala de nuevo en la lista.",
    );
  }

  return { localidad: localidad.nombre, localidadId: localidad.id };
}
