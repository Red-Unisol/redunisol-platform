import type { CheckSocioCuitDuplicateDto } from "../dtos/CheckSocioCuitDuplicate.dto";
import { normalizeCuit } from "../services/SocioInputNormalizer";
import type { SocioRepository } from "../../domain/repositories/SocioRepository";

type Dependencies = {
  repository: SocioRepository;
};

export type CheckSocioCuitDuplicateResult = {
  exists: boolean;
};

export class CheckSocioCuitDuplicateUseCase {
  private readonly repository: SocioRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  async execute(
    input: CheckSocioCuitDuplicateDto,
  ): Promise<CheckSocioCuitDuplicateResult> {
    const cuit = normalizeCuit(input.cuit);
    const existingSocio = await this.repository.findByCuit(
      cuit,
      input.excludeSocioId,
    );

    return {
      exists: existingSocio !== null,
    };
  }
}
