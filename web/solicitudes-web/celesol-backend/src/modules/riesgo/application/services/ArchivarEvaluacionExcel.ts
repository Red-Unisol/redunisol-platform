import { createHash } from "node:crypto";
import type { EvaluacionRiesgoRepository } from "../../domain/repositories/EvaluacionRiesgoRepository";
import type { SolicitudAdjuntoRepository } from "../../../solicitudes-core/adjuntos/domain/repositories/SolicitudAdjuntoRepository";
import type { AdjuntosObjectStorage } from "../../../solicitudes-core/adjuntos/domain/services/AdjuntosObjectStorage";
import { EvaluacionArchivoUnavailableError } from "../../domain/riesgo-errors";

export type ArchivarEvaluacionInput = {
  solicitudId: string;
  actorId: string;
  etapa: "generacion" | "liquidacion";
};
type Dependencies = {
  evaluaciones: Pick<EvaluacionRiesgoRepository, "findBySolicitudId">;
  adjuntos: Pick<SolicitudAdjuntoRepository, "findById" | "create">;
  storage: Pick<AdjuntosObjectStorage, "getObjectStream" | "uploadObject">;
  exportar: (snapshot: unknown) => Promise<Buffer>;
  bucket: string;
};

export class ArchivarEvaluacionExcel {
  constructor(private readonly dependencies: Dependencies) {}

  async execute(input: ArchivarEvaluacionInput): Promise<void> {
    try {
      const evaluacion = await this.dependencies.evaluaciones.findBySolicitudId(
        input.solicitudId,
      );
      // No se introduce una nueva obligación de tener Evaluación para operar.
      if (!evaluacion) return;
      const stream = await this.dependencies.storage.getObjectStream({
        bucket: evaluacion.storageBucket,
        key: evaluacion.storageKey,
      });
      const parts: Buffer[] = [];
      for await (const part of stream)
        parts.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
      const snapshot = JSON.parse(
        Buffer.concat(parts).toString("utf8"),
      ) as unknown;
      const hash = createHash("sha256")
        .update(input.solicitudId)
        .update(JSON.stringify(snapshot))
        .digest("hex");
      // Identidad estable de la copia: reintentos y liquidar sin cambios no duplican.
      let id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      let existente = await this.dependencies.adjuntos.findById(id);
      if (existente && existente.deletedAt === null) return;
      while (existente?.deletedAt) {
        const restoredHash = createHash("sha256")
          .update(id)
          .update(existente.deletedAt.toISOString())
          .digest("hex");
        id = `${restoredHash.slice(0, 8)}-${restoredHash.slice(8, 12)}-5${restoredHash.slice(13, 16)}-a${restoredHash.slice(17, 20)}-${restoredHash.slice(20, 32)}`;
        existente = await this.dependencies.adjuntos.findById(id);
        if (existente && existente.deletedAt === null) return;
      }
      const buffer = await this.dependencies.exportar(snapshot);
      const key = `solicitudes/${input.solicitudId}/adjuntos/evaluacion-${id}.xlsx`;
      const mime =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      await this.dependencies.storage.uploadObject({
        bucket: this.dependencies.bucket,
        key,
        body: buffer,
        contentType: mime,
      });
      try {
        await this.dependencies.adjuntos.create({
          adjuntoId: id,
          solicitudId: input.solicitudId,
          archivoNombre: `Evaluacion-${input.etapa}-${evaluacion.guardadaEn.toISOString().replace(/[:.]/g, "-")}.xlsx`,
          archivoPath: key,
          archivoMimeType: mime,
          archivoSizeBytes: buffer.length,
          storageBucket: this.dependencies.bucket,
          tipoAdjunto: "Documentación Adicional",
          estadoAdjunto: null,
          descripcion: `Evaluación guardada utilizada al solicitar ${input.etapa === "generacion" ? "generación" : "liquidación"} del préstamo`,
          comentario: `Guardada: ${evaluacion.guardadaEn.toISOString()}. Analista: ${evaluacion.guardadaPor?.nombre ?? "No disponible"}.`,
          adicional: null,
          nroDocumento: null,
          restringido: false,
          uploadedBy: input.actorId,
        });
      } catch (error) {
        // Otra petición concurrente pudo registrar la misma copia.
        const concurrente = await this.dependencies.adjuntos.findById(id);
        if (!concurrente || concurrente.deletedAt !== null) throw error;
      }
    } catch {
      throw new EvaluacionArchivoUnavailableError();
    }
  }
}
