import type { DownloadSolicitudAdjuntoInput } from "../dtos/DownloadSolicitudAdjunto.dto";
import type { SolicitudAdjunto } from "../../domain/entities/SolicitudAdjunto.entity";
import type { SolicitudAdjuntoRepository } from "../../domain/repositories/SolicitudAdjuntoRepository";
import type { AdjuntosObjectStorage } from "../../domain/services/AdjuntosObjectStorage";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import { canEditSolicitud } from "../../../application/services/SolicitudPermissions";
import {
  ForbiddenSolicitudAdjuntoAccessError,
  SolicitudAdjuntoNotFoundError,
  SolicitudAdjuntoStorageReferenceMissingError,
  SolicitudAdjuntoStorageUnavailableError,
} from "../../domain/solicitudes-adjuntos-errors";

type DownloadSolicitudAdjuntoUseCaseDependencies = {
  objectStorage: AdjuntosObjectStorage;
  repository: SolicitudAdjuntoRepository;
  solicitudesRepository: SolicitudesCoreRepository;
};

export class DownloadSolicitudAdjuntoUseCase {
  constructor(
    private readonly dependencies: DownloadSolicitudAdjuntoUseCaseDependencies,
  ) {}

  async execute(
    input: DownloadSolicitudAdjuntoInput,
  ): Promise<{ adjunto: SolicitudAdjunto; stream: NodeJS.ReadableStream }> {
    const solicitud = await this.dependencies.solicitudesRepository.findById(
      input.solicitudId,
    );

    if (!solicitud) {
      throw new SolicitudAdjuntoNotFoundError();
    }

    if (!canEditSolicitud(input.currentUser, solicitud, "DOWNLOAD_ATTACHMENT")) {
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

    if (!adjunto.archivoPath || !adjunto.storageBucket) {
      throw new SolicitudAdjuntoStorageReferenceMissingError();
    }

    try {
      const stream = await this.dependencies.objectStorage.getObjectStream({
        bucket: adjunto.storageBucket,
        key: adjunto.archivoPath,
      });

      return { adjunto, stream };
    } catch {
      throw new SolicitudAdjuntoStorageUnavailableError();
    }
  }
}
