import type { GetSocioByIdDto } from "../dtos/GetSocioById.dto";
import { SocioNotFoundError } from "../../domain/socios-errors";
import type { SocioRepository } from "../../domain/repositories/SocioRepository";

type Dependencies = {
  repository: SocioRepository;
};

export class GetSocioByIdUseCase {
  private readonly repository: SocioRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  async execute(input: GetSocioByIdDto) {
    const socio = await this.repository.findById(input.id);

    if (!socio) {
      throw new SocioNotFoundError();
    }

    return socio;
  }
}
