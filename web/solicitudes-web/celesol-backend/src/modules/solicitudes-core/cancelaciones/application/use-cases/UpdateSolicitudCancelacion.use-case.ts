import type { UpdateSolicitudCancelacionInput } from "../dtos/UpdateSolicitudCancelacion.dto";
import type { SolicitudCancelacion } from "../../domain/entities/SolicitudCancelacion.entity";
import type { SolicitudCancelacionRepository } from "../../domain/repositories/SolicitudCancelacionRepository";
import type { SolicitudFieldAccessRulesRepository } from "../../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import { canManageSolicitudAttachments } from "../../../application/services/SolicitudPermissions";
import {
  ForbiddenSolicitudCancelacionAccessError,
  SolicitudCancelacionNotFoundError,
} from "../../domain/solicitudes-cancelaciones-errors";

type UpdateSolicitudCancelacionUseCaseDependencies = {
  repository: SolicitudCancelacionRepository;
  fieldAccessRulesRepository: SolicitudFieldAccessRulesRepository;
  solicitudesRepository: SolicitudesCoreRepository;
};

export class UpdateSolicitudCancelacionUseCase {
  constructor(
    private readonly dependencies: UpdateSolicitudCancelacionUseCaseDependencies,
  ) {}

  async execute(
    input: UpdateSolicitudCancelacionInput,
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

    return this.dependencies.repository.update({
      cancelacionId: input.cancelacionId,
      cbu: input.cbu,
      cuentaADebitar: input.cuentaADebitar,
      cuentaBancaria: input.cuentaBancaria,
      monto: input.monto,
      notas: input.notas,
      socio: input.socio,
      socioLegacyId: input.socioLegacyId,
    });
  }
}
