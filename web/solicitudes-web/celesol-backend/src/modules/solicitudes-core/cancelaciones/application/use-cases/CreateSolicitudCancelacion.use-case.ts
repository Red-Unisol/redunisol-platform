import { randomUUID } from "node:crypto";

import type { CreateSolicitudCancelacionInput } from "../dtos/CreateSolicitudCancelacion.dto";
import type { SolicitudCancelacion } from "../../domain/entities/SolicitudCancelacion.entity";
import type { SolicitudCancelacionRepository } from "../../domain/repositories/SolicitudCancelacionRepository";
import type { SolicitudFieldAccessRulesRepository } from "../../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import { canManageSolicitudAttachments } from "../../../application/services/SolicitudPermissions";
import {
  ForbiddenSolicitudCancelacionAccessError,
  SolicitudCancelacionNotFoundError,
} from "../../domain/solicitudes-cancelaciones-errors";

type CreateSolicitudCancelacionUseCaseDependencies = {
  repository: SolicitudCancelacionRepository;
  fieldAccessRulesRepository: SolicitudFieldAccessRulesRepository;
  solicitudesRepository: SolicitudesCoreRepository;
};

export class CreateSolicitudCancelacionUseCase {
  constructor(
    private readonly dependencies: CreateSolicitudCancelacionUseCaseDependencies,
  ) {}

  async execute(
    input: CreateSolicitudCancelacionInput,
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

    return this.dependencies.repository.create({
      cancelacionId: randomUUID(),
      cbu: input.cbu,
      createdBy: input.createdBy,
      cuentaADebitar: input.cuentaADebitar,
      cuentaBancaria: input.cuentaBancaria,
      monto: input.monto,
      notas: input.notas ?? null,
      socio: input.socio,
      socioLegacyId: input.socioLegacyId ?? null,
      solicitudId: input.solicitudId,
    });
  }
}
