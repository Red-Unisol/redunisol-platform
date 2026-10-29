import { randomUUID } from "node:crypto";

import type { SolicitudAdjuntoRepository } from "../../adjuntos/domain/repositories/SolicitudAdjuntoRepository";
import type { AdjuntosObjectStorage } from "../../adjuntos/domain/services/AdjuntosObjectStorage";

type Dependencies = {
  adjuntos: Pick<
    SolicitudAdjuntoRepository,
    "create" | "listBySolicitudId" | "softDelete"
  >;
  bucket: string;
  now?: () => Date;
  storage: Pick<AdjuntosObjectStorage, "uploadObject">;
};

// Asi se reconocen los comprobantes de refinanciacion entre los adjuntos de
// la solicitud, para reemplazarlos.
const PREFIJO_ARCHIVO = "refinanciacion-";

/**
 * El comprobante de la refinanciacion en los adjuntos de la solicitud, como
 * lo hacen a mano los analistas con el "Prestamos Pagos" de Vimarx. Hay uno
 * solo por solicitud: uno nuevo da de baja al anterior.
 */
export class ArchivarComprobanteRefinanciacion {
  private readonly now: () => Date;

  constructor(private readonly dependencies: Dependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async guardar(input: {
    actorId: string;
    descripcion: string;
    nombre: string;
    pdf: Buffer;
    solicitudId: string;
  }): Promise<{ adjuntoId: string }> {
    const adjuntoId = randomUUID();
    const key = `solicitudes/${input.solicitudId}/adjuntos/${PREFIJO_ARCHIVO}${adjuntoId}.pdf`;

    await this.dependencies.storage.uploadObject({
      body: input.pdf,
      bucket: this.dependencies.bucket,
      contentType: "application/pdf",
      key,
    });
    await this.dependencies.adjuntos.create({
      adicional: null,
      adjuntoId,
      archivoMimeType: "application/pdf",
      archivoNombre: input.nombre,
      archivoPath: key,
      archivoSizeBytes: input.pdf.length,
      comentario: null,
      descripcion: input.descripcion,
      estadoAdjunto: null,
      nroDocumento: null,
      restringido: false,
      solicitudId: input.solicitudId,
      storageBucket: this.dependencies.bucket,
      tipoAdjunto: "Documentación Adicional",
      uploadedBy: input.actorId,
    });
    // Recien con el nuevo guardado: si algo fallo antes, queda el anterior.
    await this.quitar({
      actorId: input.actorId,
      excepto: adjuntoId,
      motivo: "Reemplazado por un comprobante de refinanciación nuevo.",
      solicitudId: input.solicitudId,
    });

    return { adjuntoId };
  }

  /** Da de baja los comprobantes de refinanciacion vigentes de la solicitud. */
  async quitar(input: {
    actorId: string;
    excepto?: string;
    motivo: string;
    solicitudId: string;
  }) {
    const adjuntos = await this.dependencies.adjuntos.listBySolicitudId(
      input.solicitudId,
    );

    for (const adjunto of adjuntos) {
      if (
        adjunto.deletedAt === null &&
        adjunto.id !== input.excepto &&
        esComprobanteRefinanciacion(adjunto.archivoPath)
      ) {
        await this.dependencies.adjuntos.softDelete({
          adjuntoId: adjunto.id,
          deletedAt: this.now(),
          deletedBy: input.actorId,
          deleteReason: input.motivo,
        });
      }
    }
  }
}

function esComprobanteRefinanciacion(path: string | null) {
  return (
    path !== null &&
    path.split("/").at(-1)?.startsWith(PREFIJO_ARCHIVO) === true
  );
}
