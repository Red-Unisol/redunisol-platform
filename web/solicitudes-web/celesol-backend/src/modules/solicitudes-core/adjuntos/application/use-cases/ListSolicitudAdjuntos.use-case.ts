import type { ListSolicitudAdjuntosInput } from "../dtos/ListSolicitudAdjuntos.dto";
import type { SolicitudAdjunto } from "../../domain/entities/SolicitudAdjunto.entity";
import type { SolicitudAdjuntoRepository } from "../../domain/repositories/SolicitudAdjuntoRepository";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import { canEditSolicitud } from "../../../application/services/SolicitudPermissions";
import {
  ForbiddenSolicitudAdjuntoAccessError,
  SolicitudAdjuntoNotFoundError,
} from "../../domain/solicitudes-adjuntos-errors";

type ListSolicitudAdjuntosUseCaseDependencies = {
  repository: SolicitudAdjuntoRepository;
  solicitudesRepository: SolicitudesCoreRepository;
};

export class ListSolicitudAdjuntosUseCase {
  constructor(
    private readonly dependencies: ListSolicitudAdjuntosUseCaseDependencies,
  ) {}

  async execute(input: ListSolicitudAdjuntosInput): Promise<SolicitudAdjunto[]> {
    const solicitud = await this.dependencies.solicitudesRepository.findById(
      input.solicitudId,
    );

    if (!solicitud) {
      throw new SolicitudAdjuntoNotFoundError();
    }

    if (!canEditSolicitud(input.currentUser, solicitud, "DOWNLOAD_ATTACHMENT")) {
      throw new ForbiddenSolicitudAdjuntoAccessError();
    }

    const adjuntos = await this.dependencies.repository.listBySolicitudId(
      input.solicitudId,
    );

    return adjuntos.filter((adjunto) => adjunto.deletedAt === null);
  }
}
