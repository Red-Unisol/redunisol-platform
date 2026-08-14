import { normalizeCuit, normalizeDocumento } from "../../../socios/application/services/SocioInputNormalizer";
import type { Socio } from "../../../socios/domain/entities/Socio.entity";
import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";

type Dependencies = {
  sociosRepository: SocioRepository;
};

type TitularDocumento = {
  cuit: string | null;
  nroDocumento: string | null;
  tipoDocumento: string | null;
};

type LookupCandidate = {
  documento: string;
  tipoDocumento?: string;
};

export class FindSolicitudTitularSocio {
  private readonly sociosRepository: SocioRepository;

  constructor(dependencies: Dependencies) {
    this.sociosRepository = dependencies.sociosRepository;
  }

  async execute(titular: TitularDocumento): Promise<Socio | null> {
    const lookupCandidates = buildLookupCandidates(titular);

    for (const candidate of lookupCandidates) {
      const socios = await this.sociosRepository.lookupByDocumento(
        candidate.documento,
        candidate.tipoDocumento,
      );

      if (socios.length > 0) {
        return socios[0];
      }
    }

    return null;
  }
}

function buildLookupCandidates(titular: TitularDocumento): LookupCandidate[] {
  const candidates: LookupCandidate[] = [];
  const normalizedDocumento = titular.nroDocumento?.trim()
    ? normalizeDocumento(titular.nroDocumento)
    : null;
  const normalizedTipoDocumento = titular.tipoDocumento?.trim()
    ? titular.tipoDocumento.trim().toUpperCase()
    : undefined;

  if (normalizedDocumento) {
    candidates.push({
      documento: normalizedDocumento,
      ...(normalizedTipoDocumento ? { tipoDocumento: normalizedTipoDocumento } : {}),
    });
  }

  const normalizedCuit = normalizeOptionalCuit(titular.cuit);

  if (
    normalizedCuit &&
    !candidates.some((candidate) => candidate.documento === normalizedCuit)
  ) {
    candidates.push({ documento: normalizedCuit });
  }

  return candidates;
}

function normalizeOptionalCuit(value: string | null) {
  if (!value?.trim()) {
    return null;
  }

  try {
    return normalizeCuit(value);
  } catch {
    return null;
  }
}
