import type { DeleteSocioDto } from "../dtos/DeleteSocio.dto";
import { SocioNotFoundError } from "../../domain/socios-errors";
import type { SocioRepository } from "../../domain/repositories/SocioRepository";

type Dependencies = {
  repository: SocioRepository;
};

export class DeleteSocioUseCase {
  private readonly repository: SocioRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  async execute(input: DeleteSocioDto): Promise<void> {
    const socio = await this.repository.findById(input.id);

    if (!socio) {
      throw new SocioNotFoundError();
    }

    await this.repository.delete(input.id);
  }
}
