import type { ListSolicitudTransitionsInput } from "../dtos/ListSolicitudTransitions.dto";
import { AnnotateSolicitudTransitionsBlockedReason } from "../services/AnnotateSolicitudTransitionsBlockedReason";
import type { SolicitudWorkflowRepository } from "../../domain/repositories/SolicitudWorkflowRepository";
import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";

type Dependencies = {
  repository: SolicitudWorkflowRepository;
  sociosRepository: SocioRepository;
  solicitudesRepository: SolicitudesCoreRepository;
};

export class ListSolicitudTransitionsUseCase {
  private readonly annotateSolicitudTransitionsBlockedReason: AnnotateSolicitudTransitionsBlockedReason;
  private readonly repository: SolicitudWorkflowRepository;
  private readonly solicitudesRepository: SolicitudesCoreRepository;

  constructor(dependencies: Dependencies) {
    this.annotateSolicitudTransitionsBlockedReason =
      new AnnotateSolicitudTransitionsBlockedReason({
        sociosRepository: dependencies.sociosRepository,
        solicitudesRepository: dependencies.solicitudesRepository,
      });
    this.repository = dependencies.repository;
    this.solicitudesRepository = dependencies.solicitudesRepository;
  }

  async execute(input: ListSolicitudTransitionsInput) {
    // Necesitamos el codigo de owner (no solo el id) para la excepcion de
    // RIESGO en la transicion "pagar" (ver SolicitudWorkflowPrismaDatasource).
    const workflowOwnerCode =
      !input.isSystemAdmin && this.solicitudesRepository.findWorkflowOwnerCodeById
        ? await this.solicitudesRepository.findWorkflowOwnerCodeById(
            input.workflowOwnerId,
          )
        : null;

    const transitions = await this.repository.listAvailableTransitions({
      ...input,
      ...(workflowOwnerCode ? { workflowOwnerCode } : {}),
    });

    return this.annotateSolicitudTransitionsBlockedReason.execute(
      transitions,
      input.solicitudId,
    );
  }
}
