import type {
  GetSolicitudesStatsInput,
  SolicitudesCoreRepository,
} from "../../domain/repositories/SolicitudesCoreRepository";

export class GetVendedorDashboardStatsUseCase {
  private readonly repository: SolicitudesCoreRepository;

  constructor({ repository }: { repository: SolicitudesCoreRepository }) {
    this.repository = repository;
  }

  execute(input: GetSolicitudesStatsInput) {
    return this.repository.getVendedorStats!(input);
  }
}
