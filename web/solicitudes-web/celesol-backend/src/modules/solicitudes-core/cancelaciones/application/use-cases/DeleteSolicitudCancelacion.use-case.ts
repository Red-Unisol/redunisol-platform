import type { DeleteSolicitudCancelacionInput } from "../dtos/DeleteSolicitudCancelacion.dto";
import type { SolicitudCancelacion } from "../../domain/entities/SolicitudCancelacion.entity";
import type { SolicitudCancelacionRepository } from "../../domain/repositories/SolicitudCancelacionRepository";
import type { SolicitudFieldAccessRulesRepository } from "../../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import { canManageSolicitudAttachments } from "../../../application/services/SolicitudPermissions";
import {
  ForbiddenSolicitudCancelacionAccessError,
  SolicitudCancelacionNotFoundError,
} from "../../domain/solicitudes-cancelaciones-errors";

type DeleteSolicitudCancelacionUseCaseDependencies = {
  now: () => Date;
  repository: SolicitudCancelacionRepository;
  fieldAccessRulesRepository: SolicitudFieldAccessRulesRepository;
  solicitudesRepository: SolicitudesCoreRepository;
};

export class DeleteSolicitudCancelacionUseCase {
  constructor(
    private readonly dependencies: DeleteSolicitudCancelacionUseCaseDependencies,
  ) {}

  async execute(
    input: DeleteSolicitudCancelacionInput,
  ): Promise<SolicitudCancelacion> {
    const solicitud = await this.dependencies.solicitudesRepository.findById(
      input.solicitudId,
    );

    if (!solicitud) {
      throw new SolicitudCancelacionNotFoundError();
    }

    const fieldAccessRule =
      await this.dependencies.fieldAccessRulesRepository.findByWorkflowStateId(
        solicitud.estadoActual.id,
      );

    if (
      !canManageSolicitudAttachments({
        fieldAccess: fieldAccessRule,
        solicitud,
        user: input.currentUser,
      })
    ) {
      throw new ForbiddenSolicitudCancelacionAccessError();
    }

    const cancelacion = await this.dependencies.repository.findById(
      input.cancelacionId,
    );

    if (
      !cancelacion ||
      cancelacion.solicitudId !== input.solicitudId ||
      cancelacion.deletedAt !== null
    ) {
      throw new SolicitudCancelacionNotFoundError();
    }

    return this.dependencies.repository.softDelete({
      cancelacionId: input.cancelacionId,
      deletedAt: this.dependencies.now(),
      deletedBy: input.deletedBy,
    });
  }
}
