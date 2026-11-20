import type { GetSolicitudByIdInput } from "../dtos/GetSolicitudById.dto";
import { ForbiddenSolicitudAccessError, SolicitudCoreNotFoundError } from "../../domain/solicitudes-core-errors";
import type { SolicitudFieldAccessRulesRepository } from "../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import {
  buildSolicitudCapabilities,
  canViewSolicitud,
} from "../services/SolicitudPermissions";
import {
  buildSolicitudAppearance,
  buildSolicitudFieldAccess,
} from "../services/SolicitudFieldAccess";

type Dependencies = {
  fieldAccessRulesRepository: SolicitudFieldAccessRulesRepository;
  repository: SolicitudesCoreRepository;
};

export class GetSolicitudByIdUseCase {
  private readonly fieldAccessRulesRepository: SolicitudFieldAccessRulesRepository;
  private readonly repository: SolicitudesCoreRepository;

  constructor(dependencies: Dependencies) {
    this.fieldAccessRulesRepository = dependencies.fieldAccessRulesRepository;
    this.repository = dependencies.repository;
  }

  async execute(input: GetSolicitudByIdInput) {
    const solicitud = await this.repository.findById(input.id, { withSellerReviewChanges: true });

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    if (!canViewSolicitud(input.currentUser, solicitud)) {
      throw new ForbiddenSolicitudAccessError();
    }

    const fieldAccessRule =
      await this.fieldAccessRulesRepository.findByWorkflowStateId(
        solicitud.estadoActual.id,
        solicitud.estadoActual.code === "Liquidada" && Boolean(solicitud.sellerReviewStartedAt),
      );

    // El área autenticada determina las excepciones de edición y workflow.
    const workflowOwnerCode =
      !input.currentUser.isSystemAdmin &&
      input.currentUser.workflowOwnerId &&
      this.repository.findWorkflowOwnerCodeById
        ? await this.repository.findWorkflowOwnerCodeById(
            input.currentUser.workflowOwnerId,
          )
        : null;
    const currentUser = {
      ...input.currentUser,
      ...(workflowOwnerCode ? { workflowOwnerCode } : {}),
    };

    const { sellerReviewChanges, ...detail } = solicitud;
    const canViewChanges = input.currentUser.isSystemAdmin || workflowOwnerCode === "RIESGO";
    return {
      ...detail,
      ...(canViewChanges && sellerReviewChanges?.length ? { sellerReviewChanges } : {}),
      appearance: buildSolicitudAppearance(
        solicitud,
        fieldAccessRule,
        input.currentUser.isSystemAdmin,
      ),
      capabilities: {
        ...buildSolicitudCapabilities(currentUser, solicitud, fieldAccessRule),
        fieldAccess: buildSolicitudFieldAccess(
          solicitud,
          fieldAccessRule,
          input.currentUser.isSystemAdmin,
        ),
      },
    };
  }
}
