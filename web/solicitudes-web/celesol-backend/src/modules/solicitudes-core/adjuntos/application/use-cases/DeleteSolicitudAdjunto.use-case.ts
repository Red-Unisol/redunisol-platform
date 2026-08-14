import type { DeleteSolicitudAdjuntoInput } from "../dtos/DeleteSolicitudAdjunto.dto";
import type { SolicitudAdjunto } from "../../domain/entities/SolicitudAdjunto.entity";
import type { SolicitudAdjuntoRepository } from "../../domain/repositories/SolicitudAdjuntoRepository";
import type { SolicitudFieldAccessRulesRepository } from "../../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import { canManageSolicitudAttachments } from "../../../application/services/SolicitudPermissions";
import {
  ForbiddenSolicitudAdjuntoAccessError,
  SolicitudAdjuntoNotFoundError,
} from "../../domain/solicitudes-adjuntos-errors";

type DeleteSolicitudAdjuntoUseCaseDependencies = {
  now: () => Date;
  repository: SolicitudAdjuntoRepository;
  fieldAccessRulesRepository: SolicitudFieldAccessRulesRepository;
  solicitudesRepository: SolicitudesCoreRepository;
};

export class DeleteSolicitudAdjuntoUseCase {
  constructor(
    private readonly dependencies: DeleteSolicitudAdjuntoUseCaseDependencies,
  ) {}

  async execute(input: DeleteSolicitudAdjuntoInput): Promise<SolicitudAdjunto> {
    const solicitud = await this.dependencies.solicitudesRepository.findById(
      input.solicitudId,
    );

    if (!solicitud) {
      throw new SolicitudAdjuntoNotFoundError();
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
      throw new ForbiddenSolicitudAdjuntoAccessError();
    }

    const adjunto = await this.dependencies.repository.findById(input.adjuntoId);

    if (
      !adjunto ||
      adjunto.solicitudId !== input.solicitudId ||
      adjunto.deletedAt !== null
    ) {
      throw new SolicitudAdjuntoNotFoundError();
    }

    return this.dependencies.repository.softDelete({
      adjuntoId: input.adjuntoId,
      deletedAt: this.dependencies.now(),
      deletedBy: input.deletedBy,
      deleteReason: input.deleteReason ?? null,
    });
  }
}
