import type { ListSolicitudTransitionsInput } from "../dtos/ListSolicitudTransitions.dto";
import { AnnotateSolicitudTransitionsBlockedReason } from "../services/AnnotateSolicitudTransitionsBlockedReason";
import type { SolicitudWorkflowRepository } from "../../domain/repositories/SolicitudWorkflowRepository";
import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";

type Dependencies = {
  repository: SolicitudWorkflowRepository;
  sociosRepository: SocioRepository;
  solicitudesRepository: SolicitudesCoreRepository;
  documentReviewRequired?: boolean;
};

export class ListSolicitudTransitionsUseCase {
  private readonly annotateSolicitudTransitionsBlockedReason: AnnotateSolicitudTransitionsBlockedReason;
  private readonly repository: SolicitudWorkflowRepository;
  private readonly solicitudesRepository: SolicitudesCoreRepository;
  private readonly documentReviewRequired: boolean;

  constructor(dependencies: Dependencies) {
    this.documentReviewRequired = dependencies.documentReviewRequired ?? false;
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
      this.documentReviewRequired ? transitions.map(t => ["transferir", "devolver_a_liquidada"].includes(t.actionCode)
        ? { ...t, blockedReason: "Registrá la aprobación o desaprobación humana en Revisión de firma." } : t) : transitions,
      input.solicitudId,
    );
  }
}
