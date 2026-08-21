import type { LookupSocioByDocumentoDto } from "../dtos/LookupSocioByDocumento.dto";
import { normalizeDocumento } from "../services/SocioInputNormalizer";
import type { Socio } from "../../domain/entities/Socio.entity";
import type { SocioRepository } from "../../domain/repositories/SocioRepository";

type Dependencies = {
  repository: SocioRepository;
};

export type LookupSocioByDocumentoResult =
  | {
      match: "none";
    }
  | {
      match: "multiple";
    }
  | {
      match: "single";
      socio: Socio;
    };

export class LookupSocioByDocumentoUseCase {
  private readonly repository: SocioRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  async execute(
    input: LookupSocioByDocumentoDto,
  ): Promise<LookupSocioByDocumentoResult> {
    const documento = normalizeDocumento(input.documento);
    const tipoDocumento = input.tipoDocumento?.trim().toUpperCase() || undefined;
    const matches = await this.repository.lookupByDocumento(
      documento,
      tipoDocumento,
    );

    if (matches.length === 0) {
      return {
        match: "none",
      };
    }

    if (matches.length > 1) {
      return {
        match: "multiple",
      };
    }

    return {
      match: "single",
      socio: matches[0],
    };
  }
}

