import type { AdjuntosObjectStorage } from "../../../solicitudes-core/adjuntos/domain/services/AdjuntosObjectStorage";
import type { EvaluacionRiesgoRepository } from "../../domain/repositories/EvaluacionRiesgoRepository";
import {
  EvaluacionStorageUnavailableError,
  SolicitudNotFoundError,
} from "../../domain/riesgo-errors";

type Dependencies = {
  objectStorage: Pick<AdjuntosObjectStorage, "getObjectStream">;
  repository: Pick<
    EvaluacionRiesgoRepository,
    "findBySolicitudId" | "findEstadoActualDeSolicitud"
  >;
};

export type EvaluacionRiesgoDto = {
  guardadaEn: string;
  guardadaPor: { id: string; nombre: string } | null;
  nivelRiesgo: number | null;
  /** Snapshot de la planilla (IWorkbookData de Univer), tal como se guardo. */
  snapshot: unknown;
};

export class GetEvaluacionRiesgoUseCase {
  constructor(private readonly dependencies: Dependencies) {}

  async execute(input: {
    solicitudId: string;
  }): Promise<EvaluacionRiesgoDto | null> {
    const estado =
      await this.dependencies.repository.findEstadoActualDeSolicitud(
        input.solicitudId,
      );

    if (!estado) {
      throw new SolicitudNotFoundError();
    }

    const evaluacion = await this.dependencies.repository.findBySolicitudId(
      input.solicitudId,
    );

    if (!evaluacion) {
      return null;
    }

    let snapshot: unknown;

    try {
      const stream = await this.dependencies.objectStorage.getObjectStream({
        bucket: evaluacion.storageBucket,
        key: evaluacion.storageKey,
      });
      snapshot = JSON.parse(await leerTexto(stream));
    } catch {
      throw new EvaluacionStorageUnavailableError();
    }

    return {
      guardadaEn: evaluacion.guardadaEn.toISOString(),
      guardadaPor: evaluacion.guardadaPor,
      nivelRiesgo: evaluacion.nivelRiesgo,
      snapshot,
    };
  }
}

async function leerTexto(stream: NodeJS.ReadableStream) {
  const partes: Buffer[] = [];

  for await (const parte of stream) {
    partes.push(Buffer.isBuffer(parte) ? parte : Buffer.from(parte));
  }

  return Buffer.concat(partes).toString("utf-8");
}
