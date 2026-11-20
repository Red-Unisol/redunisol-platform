import type { AuthWorkflowOwner } from "../../../auth/domain/entities/User.entity";
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
  workflowOwners?: AuthWorkflowOwner[];
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
    const { workflowOwnerId, workflowOwners, ...rest } = input;
    const areaOwnerCode = workflowOwners ? workflowOwners.map(area => area.code) : workflowOwnerId
      ? ((await this.repository.findWorkflowOwnerCodeById!(workflowOwnerId)) ?? "")
      : "";

    return this.repository.getAnalistaStats!({ ...rest, areaOwnerCode });
  }
}
