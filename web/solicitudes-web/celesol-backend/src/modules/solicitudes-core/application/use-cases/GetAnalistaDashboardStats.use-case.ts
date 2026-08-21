import type {
  AnalistaDashboardStatsResult,
  GetSolicitudesStatsInput,
  SolicitudesCoreRepository,
} from "../../domain/repositories/SolicitudesCoreRepository";

type GetAnalistaDashboardStatsInput = GetSolicitudesStatsInput & {
  analistaId: string;
  conRetrabajo?: "con" | "sin";
  umbralDias: number;
  vista: "mis_casos" | "sin_asignar" | "ambos";
  workflowOwnerId: string | null;
};

export class GetAnalistaDashboardStatsUseCase {
  private readonly repository: SolicitudesCoreRepository;

  constructor({ repository }: { repository: SolicitudesCoreRepository }) {
    this.repository = repository;
  }

  async execute(
    input: GetAnalistaDashboardStatsInput,
  ): Promise<AnalistaDashboardStatsResult> {
    const { workflowOwnerId, ...rest } = input;
    const areaOwnerCode = workflowOwnerId
      ? ((await this.repository.findWorkflowOwnerCodeById!(workflowOwnerId)) ?? "")
      : "";

    return this.repository.getAnalistaStats!({ ...rest, areaOwnerCode });
  }
}
