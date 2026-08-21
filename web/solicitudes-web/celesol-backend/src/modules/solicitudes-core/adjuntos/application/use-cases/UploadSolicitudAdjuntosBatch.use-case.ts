import { extname } from "node:path";
import { randomUUID } from "node:crypto";

import type { SolicitudAdjunto } from "../../domain/entities/SolicitudAdjunto.entity";
import type {
  CreateSolicitudAdjuntoRecord,
  SolicitudAdjuntoRepository,
} from "../../domain/repositories/SolicitudAdjuntoRepository";
import type { AdjuntosObjectStorage } from "../../domain/services/AdjuntosObjectStorage";
import { MAX_ADJUNTOS_LOTE, TIPO_ADJUNTO_VALUES } from "../../domain/TiposAdjuntoCatalog";
import type { SolicitudFieldAccessRulesRepository } from "../../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import { canManageSolicitudAttachments } from "../../../application/services/SolicitudPermissions";
import {
  ForbiddenSolicitudAdjuntoAccessError,
  SolicitudAdjuntoNotFoundError,
  SolicitudAdjuntoStorageUnavailableError,
  SolicitudAdjuntoUploadNotAllowedError,
} from "../../domain/solicitudes-adjuntos-errors";
import { validateAdjuntoFile } from "../services/validateAdjuntoFile";

export type UploadSolicitudAdjuntosBatchFileInput = {
  file: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    size: number;
  };
  tipoAdjunto: string;
  descripcion?: string;
  adicional?: string;
  comentario?: string;
  nroDocumento?: string;
  restringido?: boolean;
};

export type UploadSolicitudAdjuntosBatchInput = {
  solicitudId: string;
  createdBy: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwnerId: string | null;
  };
  workflowOwnerId: string;
  files: UploadSolicitudAdjuntosBatchFileInput[];
};

type UploadSolicitudAdjuntosBatchUseCaseDependencies = {
  objectStorage: AdjuntosObjectStorage;
  repository: SolicitudAdjuntoRepository;
  fieldAccessRulesRepository: SolicitudFieldAccessRulesRepository;
  solicitudesRepository: SolicitudesCoreRepository;
  allowedExtensions: string[];
  allowedMimeTypes: string[];
  maxFileSizeBytes: number;
  storageBucket: string;
};

export class UploadSolicitudAdjuntosBatchUseCase {
  constructor(
    private readonly dependencies: UploadSolicitudAdjuntosBatchUseCaseDependencies,
  ) {}

  async execute(
    input: UploadSolicitudAdjuntosBatchInput,
  ): Promise<SolicitudAdjunto[]> {
    if (input.files.length === 0 || input.files.length > MAX_ADJUNTOS_LOTE) {
      throw new SolicitudAdjuntoUploadNotAllowedError(
        `Debe incluir entre 1 y ${MAX_ADJUNTOS_LOTE} archivos por carga.`,
      );
    }

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

    const catalog = new Set<string>(TIPO_ADJUNTO_VALUES);

    for (const fileInput of input.files) {
      validateAdjuntoFile(
        {
          fileName: fileInput.file.fileName,
          mimeType: fileInput.file.mimeType,
          size: fileInput.file.size,
        },
        {
          allowedExtensions: this.dependencies.allowedExtensions,
          allowedMimeTypes: this.dependencies.allowedMimeTypes,
          maxFileSizeBytes: this.dependencies.maxFileSizeBytes,
        },
      );

      if (!catalog.has(fileInput.tipoAdjunto)) {
        throw new SolicitudAdjuntoUploadNotAllowedError(
          "El tipo de adjunto no pertenece al catálogo permitido.",
        );
      }
    }

    const uploaded: { bucket: string; key: string }[] = [];
    const records: CreateSolicitudAdjuntoRecord[] = [];

    try {
      for (const fileInput of input.files) {
        const adjuntoId = randomUUID();
        const extension = extname(fileInput.file.fileName).toLowerCase();
        const storageKey = `solicitudes/${input.solicitudId}/adjuntos/${adjuntoId}${extension}`;

        await this.dependencies.objectStorage.uploadObject({
          body: fileInput.file.buffer,
          bucket: this.dependencies.storageBucket,
          contentType: fileInput.file.mimeType,
          key: storageKey,
        });
        uploaded.push({ bucket: this.dependencies.storageBucket, key: storageKey });

        records.push({
          adjuntoId,
          adicional: fileInput.adicional ?? null,
          archivoMimeType: fileInput.file.mimeType,
          archivoNombre: fileInput.file.fileName,
          archivoPath: storageKey,
          archivoSizeBytes: fileInput.file.size,
          comentario: fileInput.comentario ?? null,
          descripcion: fileInput.descripcion ?? null,
          estadoAdjunto: "Cargado",
          nroDocumento: fileInput.nroDocumento ?? null,
          restringido: fileInput.restringido ?? false,
          solicitudId: input.solicitudId,
          storageBucket: this.dependencies.storageBucket,
          tipoAdjunto: fileInput.tipoAdjunto,
          uploadedBy: input.createdBy,
        });
      }
    } catch {
      await this.compensate(uploaded);
      throw new SolicitudAdjuntoStorageUnavailableError();
    }

    try {
      return await this.dependencies.repository.createMany(records);
    } catch (error) {
      await this.compensate(uploaded);
      throw error;
    }
  }

  private async compensate(uploaded: { bucket: string; key: string }[]) {
    for (const object of uploaded) {
      try {
        await this.dependencies.objectStorage.deleteObject(object);
      } catch {
        // Best-effort compensation. Preserve the original error.
      }
    }
  }
}
