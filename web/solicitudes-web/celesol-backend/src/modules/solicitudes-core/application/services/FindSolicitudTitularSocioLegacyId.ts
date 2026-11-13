import {
  normalizeCuit,
  normalizeDocumento,
} from "../../../socios/application/services/SocioInputNormalizer";

type LegacySocioLookup = {
  lookupSocioRapido(
    documento: string,
    tipoDocumento?: string,
    cuit?: string,
  ): Promise<{ id: string }[]>;
};

type TitularDocumento = {
  cuit: string | null;
  nroDocumento: string | null;
  tipoDocumento: string | null;
};

/**
 * Busca al titular directo en el padron de Vimarx y devuelve el ID de su
 * SocioMutual, el que usan las consultas de prestamos.
 *
 * No usa la tabla local de socios: esa copia deja afuera a los socios con
 * datos incompletos (por ejemplo, sin fecha de nacimiento), y para ellos la
 * pestaña Prestamos quedaba vacia aunque Vimarx tuviera sus prestamos.
 *
 * Envía también el CUIT para desempatar documentos duplicados y contemplar
 * jurídicas. Si la identidad sigue siendo ambigua no elige ninguno:
 * mostrar los prestamos de otra persona es peor que no mostrar nada.
 */
export class FindSolicitudTitularSocioLegacyId {
  private readonly gateway: LegacySocioLookup;

  constructor(dependencies: { gateway: LegacySocioLookup }) {
    this.gateway = dependencies.gateway;
  }

  async execute(titular: TitularDocumento): Promise<string | null> {
    const documento = normalizeOptional(
      normalizeDocumento,
      titular.nroDocumento,
    );
    const cuit = normalizeOptional(normalizeCuit, titular.cuit);
    if (titular.cuit?.trim() && !cuit) return null;
    if ((!documento && !cuit) || (documento && !/^\d+$/.test(documento)))
      return null;
    const matches = await this.gateway.lookupSocioRapido(
      documento ?? "",
      documento
        ? titular.tipoDocumento?.trim().toUpperCase() || undefined
        : undefined,
      cuit ?? undefined,
    );
    if (matches.length !== 1) return null;
    const id = matches[0]?.id.trim();
    return id && /^\d+$/.test(id) ? id : null;
  }
}

function normalizeOptional(
  normalize: (value: string) => string,
  value: string | null,
) {
  if (!value?.trim()) {
    return null;
  }

  try {
    return normalize(value);
  } catch {
    return null;
  }
}
