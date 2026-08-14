import { FindSolicitudTitularSocio } from "./FindSolicitudTitularSocio";
import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";
import {
  SolicitudCoreNotFoundError,
  SolicitudTitularSocioRequiredForWorkflowError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";

type Dependencies = {
  sociosRepository: SocioRepository;
  solicitudesRepository: SolicitudesCoreRepository;
};

export class EnsureSolicitudTitularSocioExists {
  private readonly findSolicitudTitularSocio: FindSolicitudTitularSocio;
  private readonly solicitudesRepository: SolicitudesCoreRepository;

  constructor(dependencies: Dependencies) {
    this.findSolicitudTitularSocio = new FindSolicitudTitularSocio({
      sociosRepository: dependencies.sociosRepository,
    });
    this.solicitudesRepository = dependencies.solicitudesRepository;
  }

  async check(solicitudId: string): Promise<boolean> {
    const solicitud = await this.solicitudesRepository.findById(solicitudId);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    const socio = await this.findSolicitudTitularSocio.execute(
      solicitud.titular,
    );

    return socio !== null;
  }

  async execute(solicitudId: string): Promise<void> {
    const socioExists = await this.check(solicitudId);

    if (!socioExists) {
      throw new SolicitudTitularSocioRequiredForWorkflowError();
    }
  }
}
