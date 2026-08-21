import type { ListSociosDto } from "../dtos/ListSocios.dto";
import type { Socio } from "../../domain/entities/Socio.entity";
import type { SocioCountRepository } from "../../domain/repositories/SocioCountRepository";
import type { SocioRepository } from "../../domain/repositories/SocioRepository";

type ListSociosRepository = Pick<SocioRepository, "list"> & SocioCountRepository;

type Dependencies = {
  repository: ListSociosRepository;
};

export type ListSociosResult = {
  items: Socio[];
  total: number;
};

export class ListSociosUseCase {
  private readonly repository: ListSociosRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  async execute(input: ListSociosDto): Promise<ListSociosResult> {
    const [items, total] = await Promise.all([
      this.repository.list(input),
      this.repository.count({ search: input.search }),
    ]);

    return { items, total };
  }
}
