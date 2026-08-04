import type {
  AnalistaDashboardStatsV2Result,
  GetSolicitudesStatsInput,
  SolicitudesCoreRepository,
} from "../../domain/repositories/SolicitudesCoreRepository";

type GetAnalistaDashboardStatsV2Input = GetSolicitudesStatsInput & {
  analistaId: string;
  conRetrabajo?: "con" | "sin";
  umbralDias: number;
  vista: "mis_casos" | "sin_asignar" | "ambos";
  workflowOwnerId: string | null;
};

export class GetAnalistaDashboardStatsV2UseCase {
  private readonly repository: SolicitudesCoreRepository;

  constructor({ repository }: { repository: SolicitudesCoreRepository }) {
    this.repository = repository;
  }

  async execute(
    input: GetAnalistaDashboardStatsV2Input,
  ): Promise<AnalistaDashboardStatsV2Result> {
    const { workflowOwnerId, ...rest } = input;
    const areaOwnerCode = workflowOwnerId
      ? ((await this.repository.findWorkflowOwnerCodeById!(workflowOwnerId)) ?? "")
      : "";

    return this.repository.getAnalistaStatsV2!({ ...rest, areaOwnerCode });
  }
}
