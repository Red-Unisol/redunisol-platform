import type { CheckSocioDocumentoDuplicateDto } from "../dtos/CheckSocioDocumentoDuplicate.dto";
import { normalizeDocumento } from "../services/SocioInputNormalizer";
import type { SocioRepository } from "../../domain/repositories/SocioRepository";

type Dependencies = {
  repository: SocioRepository;
};

export type CheckSocioDocumentoDuplicateResult = {
  exists: boolean;
};

export class CheckSocioDocumentoDuplicateUseCase {
  private readonly repository: SocioRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  async execute(
    input: CheckSocioDocumentoDuplicateDto,
  ): Promise<CheckSocioDocumentoDuplicateResult> {
    const nroDocumento = normalizeDocumento(input.nroDocumento);
    const existingSocio = await this.repository.findByDocumento(
      nroDocumento,
      input.excludeSocioId,
    );

    return {
      exists: existingSocio !== null,
    };
  }
}
