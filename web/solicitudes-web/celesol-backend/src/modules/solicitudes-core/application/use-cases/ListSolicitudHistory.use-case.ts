import type { ListSolicitudHistoryInput } from "../dtos/ListSolicitudHistory.dto";
import type { SolicitudWorkflowRepository } from "../../domain/repositories/SolicitudWorkflowRepository";

type Dependencies = {
  repository: SolicitudWorkflowRepository;
};

export class ListSolicitudHistoryUseCase {
  private readonly repository: SolicitudWorkflowRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  execute(input: ListSolicitudHistoryInput) {
    return this.repository.listHistory(input);
  }
}
