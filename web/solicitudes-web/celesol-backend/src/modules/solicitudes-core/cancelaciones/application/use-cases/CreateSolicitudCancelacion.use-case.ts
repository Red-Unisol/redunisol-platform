import { randomUUID } from "node:crypto";

import type { CreateSolicitudCancelacionInput } from "../dtos/CreateSolicitudCancelacion.dto";
import type { SolicitudCancelacion } from "../../domain/entities/SolicitudCancelacion.entity";
import type { SolicitudCancelacionRepository } from "../../domain/repositories/SolicitudCancelacionRepository";
import type { SolicitudFieldAccessRulesRepository } from "../../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import { canEditSolicitud } from "../../../application/services/SolicitudPermissions";
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

    const workflowOwnerCode =
      input.currentUser.workflowOwnerId &&
      this.dependencies.solicitudesRepository.findWorkflowOwnerCodeById
        ? await this.dependencies.solicitudesRepository.findWorkflowOwnerCodeById(
            input.currentUser.workflowOwnerId,
          )
        : null;

    const fieldAccessRule =
      await this.dependencies.fieldAccessRulesRepository.findByWorkflowStateId(
        solicitud.estadoActual.id,
      );

    if (
      !canEditSolicitud(
        { ...input.currentUser, workflowOwnerCode },
        solicitud,
        "CREATE_CANCELACION",
        fieldAccessRule,
      )
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
