import { extname } from "node:path";

import { SolicitudAdjuntoUploadNotAllowedError } from "../../domain/solicitudes-adjuntos-errors";

export function validateAdjuntoFile(
  file: { fileName: string; mimeType: string; size: number },
  limits: {
    allowedExtensions: string[];
    allowedMimeTypes: string[];
    maxFileSizeBytes: number;
  },
): void {
  const extension = extname(file.fileName).toLowerCase();
  const allowedExtensions = new Set(
    limits.allowedExtensions.map((value) => value.toLowerCase()),
  );
  const allowedMimeTypes = new Set(
    limits.allowedMimeTypes.map((value) => value.toLowerCase()),
  );

  if (!allowedExtensions.has(extension)) {
    throw new SolicitudAdjuntoUploadNotAllowedError(
      "La extensión del archivo no está permitida para adjuntos de la solicitud.",
    );
  }

  if (!allowedMimeTypes.has(file.mimeType.toLowerCase())) {
    throw new SolicitudAdjuntoUploadNotAllowedError(
      "El tipo de archivo no está permitido para adjuntos de la solicitud.",
    );
  }

  if (file.size > limits.maxFileSizeBytes) {
    throw new SolicitudAdjuntoUploadNotAllowedError(
      "El archivo supera el tamaño máximo permitido para adjuntos de la solicitud.",
    );
  }
}
