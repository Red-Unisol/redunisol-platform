import { extname } from "node:path";
import { randomUUID } from "node:crypto";

import type { UploadSolicitudAdjuntoInput } from "../dtos/UploadSolicitudAdjunto.dto";
import type { SolicitudAdjunto } from "../../domain/entities/SolicitudAdjunto.entity";
import type { SolicitudAdjuntoRepository } from "../../domain/repositories/SolicitudAdjuntoRepository";
import type { AdjuntosObjectStorage } from "../../domain/services/AdjuntosObjectStorage";
import type { SolicitudFieldAccessRulesRepository } from "../../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import { canManageSolicitudAttachments } from "../../../application/services/SolicitudPermissions";
import {
  ForbiddenSolicitudAdjuntoAccessError,
  SolicitudAdjuntoNotFoundError,
  SolicitudAdjuntoStorageUnavailableError,
} from "../../domain/solicitudes-adjuntos-errors";
import { validateAdjuntoFile } from "../services/validateAdjuntoFile";

type UploadSolicitudAdjuntoUseCaseDependencies = {
  objectStorage: AdjuntosObjectStorage;
  repository: SolicitudAdjuntoRepository;
  fieldAccessRulesRepository: SolicitudFieldAccessRulesRepository;
  solicitudesRepository: SolicitudesCoreRepository;
  allowedExtensions: string[];
  allowedMimeTypes: string[];
  maxFileSizeBytes: number;
  storageBucket: string;
};

export class UploadSolicitudAdjuntoUseCase {
  constructor(
    private readonly dependencies: UploadSolicitudAdjuntoUseCaseDependencies,
  ) {}

  async execute(input: UploadSolicitudAdjuntoInput): Promise<SolicitudAdjunto> {
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

    validateAdjuntoFile(
      {
        fileName: input.file.fileName,
        mimeType: input.file.mimeType,
        size: input.file.size,
      },
      {
        allowedExtensions: this.dependencies.allowedExtensions,
        allowedMimeTypes: this.dependencies.allowedMimeTypes,
        maxFileSizeBytes: this.dependencies.maxFileSizeBytes,
      },
    );

    const adjuntoId = randomUUID();
    const extension = extname(input.file.fileName).toLowerCase();
    const storageKey = `solicitudes/${input.solicitudId}/adjuntos/${adjuntoId}${extension}`;

    try {
      await this.dependencies.objectStorage.uploadObject({
        body: input.file.buffer,
        bucket: this.dependencies.storageBucket,
        contentType: input.file.mimeType,
        key: storageKey,
      });
    } catch {
      throw new SolicitudAdjuntoStorageUnavailableError();
    }

    try {
      return await this.dependencies.repository.create({
        adjuntoId,
        adicional: input.adicional ?? null,
        archivoMimeType: input.file.mimeType,
        archivoNombre: input.file.fileName,
        archivoPath: storageKey,
        archivoSizeBytes: input.file.size,
        comentario: input.comentario ?? null,
        descripcion: input.descripcion ?? null,
        estadoAdjunto: "Cargado",
        nroDocumento: input.nroDocumento ?? null,
        restringido: input.restringido ?? false,
        solicitudId: input.solicitudId,
        storageBucket: this.dependencies.storageBucket,
        tipoAdjunto: input.tipoAdjunto ?? null,
        uploadedBy: input.createdBy,
      });
    } catch (error) {
      try {
        await this.dependencies.objectStorage.deleteObject({
          bucket: this.dependencies.storageBucket,
          key: storageKey,
        });
      } catch {
        // Best-effort compensation. Preserve the original persistence error.
      }

      throw error;
    }
  }
}
