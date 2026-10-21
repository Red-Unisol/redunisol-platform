import { normalizeCuit, normalizeDocumento } from "../../../socios/application/services/SocioInputNormalizer";

type LegacySocioLookup = {
  lookupSocioRapido(
    documento: string,
    tipoDocumento?: string,
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
 * Prueba primero el documento y despues el CUIT (las juridicas tienen el CUIT
 * en NroDoc). Si un documento coincide con mas de un socio no elige ninguno:
 * mostrar los prestamos de otra persona es peor que no mostrar nada.
 */
export class FindSolicitudTitularSocioLegacyId {
  private readonly gateway: LegacySocioLookup;

  constructor(dependencies: { gateway: LegacySocioLookup }) {
    this.gateway = dependencies.gateway;
  }

  async execute(titular: TitularDocumento): Promise<string | null> {
    for (const candidate of buildLookupCandidates(titular)) {
      const matches = await this.gateway.lookupSocioRapido(
        candidate.documento,
        candidate.tipoDocumento,
      );

      if (matches.length > 1) {
        return null;
      }

      const id = matches[0]?.id.trim();

      if (id && /^\d+$/.test(id)) {
        return id;
      }
    }

    return null;
  }
}

function buildLookupCandidates(titular: TitularDocumento) {
  const candidates: { documento: string; tipoDocumento?: string }[] = [];
  const documento = normalizeOptional(normalizeDocumento, titular.nroDocumento);
  const tipoDocumento = titular.tipoDocumento?.trim().toUpperCase() || undefined;

  // El documento se interpola en la expresion de criterios del legado: solo
  // se aceptan digitos.
  if (documento && /^\d+$/.test(documento)) {
    candidates.push({ documento, ...(tipoDocumento ? { tipoDocumento } : {}) });
  }

  const cuit = normalizeOptional(normalizeCuit, titular.cuit);

  if (
    cuit &&
    /^\d+$/.test(cuit) &&
    !candidates.some((candidate) => candidate.documento === cuit)
  ) {
    candidates.push({ documento: cuit });
  }

  return candidates;
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
