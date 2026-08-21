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
    const solicitud = await this.repository.findById(input.id);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    if (!canViewSolicitud(input.currentUser, solicitud)) {
      throw new ForbiddenSolicitudAccessError();
    }

    const fieldAccessRule =
      await this.fieldAccessRulesRepository.findByWorkflowStateId(
        solicitud.estadoActual.id,
      );

    // Solo se necesita el codigo de owner del usuario para la excepcion de
    // RIESGO en "Transferir" (ver SolicitudPermissions.canEditSolicitud).
    const workflowOwnerCode =
      !input.currentUser.isSystemAdmin &&
      solicitud.estadoActual.code === "Transferir" &&
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

    return {
      ...solicitud,
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
