import {
  SolicitudCoreNotFoundError,
  SolicitudPrestamoLegacyRequiredForWorkflowError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";

type Dependencies = {
  solicitudesRepository: SolicitudesCoreRepository;
};

export class EnsureSolicitudHasPrestamoLegacy {
  private readonly solicitudesRepository: SolicitudesCoreRepository;

  constructor(dependencies: Dependencies) {
    this.solicitudesRepository = dependencies.solicitudesRepository;
  }

  async check(solicitudId: string): Promise<boolean> {
    const solicitud = await this.solicitudesRepository.findById(solicitudId);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    return solicitud.legacyOid !== null;
  }

  async execute(solicitudId: string): Promise<void> {
    const hasPrestamoLegacy = await this.check(solicitudId);

    if (!hasPrestamoLegacy) {
      throw new SolicitudPrestamoLegacyRequiredForWorkflowError();
    }
  }
}
