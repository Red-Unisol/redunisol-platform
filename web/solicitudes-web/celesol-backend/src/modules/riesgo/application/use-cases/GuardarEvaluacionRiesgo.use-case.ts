import type { AdjuntosObjectStorage } from "../../../solicitudes-core/adjuntos/domain/services/AdjuntosObjectStorage";
import {
  canEditSolicitud,
  type SolicitudPermissionUser,
} from "../../../solicitudes-core/application/services/SolicitudPermissions";
import type { EvaluacionRiesgoRepository } from "../../domain/repositories/EvaluacionRiesgoRepository";
import {
  EvaluacionStorageUnavailableError,
  ForbiddenGuardarEvaluacionError,
  SolicitudNotFoundError,
} from "../../domain/riesgo-errors";

type Dependencies = {
  now: () => Date;
  objectStorage: Pick<AdjuntosObjectStorage, "uploadObject">;
  repository: Pick<
    EvaluacionRiesgoRepository,
    "findBySolicitudId" | "findEstadoActualDeSolicitud" | "guardar"
  >;
  storageBucket: string;
};

export type GuardarEvaluacionRiesgoUseCaseInput = {
  currentUser: SolicitudPermissionUser;
  nivelRiesgo: number | null;
  snapshot: unknown;
  solicitudId: string;
};

/**
 * Guarda la planilla de la pestaña Evaluacion. Solo se conserva la ultima,
 * como el Evaluacion1.xlsx del legado.
 *
 * La guarda Riesgo mientras la solicitud esta a su cargo (mismo criterio que
 * editar los datos de la solicitud), o un admin.
 */
export class GuardarEvaluacionRiesgoUseCase {
  constructor(private readonly dependencies: Dependencies) {}

  async execute(input: GuardarEvaluacionRiesgoUseCaseInput) {
    const estadoActual =
      await this.dependencies.repository.findEstadoActualDeSolicitud(
        input.solicitudId,
      );

    if (!estadoActual) {
      throw new SolicitudNotFoundError();
    }

    const esRiesgoACargo =
      input.currentUser.workflowOwnerCode === "RIESGO" &&
      canEditSolicitud(input.currentUser, { estadoActual }, "EDIT_DATA");

    if (!input.currentUser.isSystemAdmin && !esRiesgoACargo) {
      throw new ForbiddenGuardarEvaluacionError();
    }

    const storageKey = `evaluaciones/${input.solicitudId}.json`;

    try {
      await this.dependencies.objectStorage.uploadObject({
        body: Buffer.from(JSON.stringify(input.snapshot), "utf-8"),
        bucket: this.dependencies.storageBucket,
        contentType: "application/json",
        key: storageKey,
      });
    } catch {
      throw new EvaluacionStorageUnavailableError();
    }

    const guardadaEn = this.dependencies.now();

    await this.dependencies.repository.guardar(input.solicitudId, {
      guardadaEn,
      guardadaPorId: input.currentUser.id,
      nivelRiesgo: input.nivelRiesgo,
      storageBucket: this.dependencies.storageBucket,
      storageKey,
    });

    // Para mostrar "Guardada por ..." sin volver a bajar la planilla.
    const guardada = await this.dependencies.repository.findBySolicitudId(
      input.solicitudId,
    );

    return {
      guardadaEn: guardadaEn.toISOString(),
      guardadaPor: guardada?.guardadaPor ?? null,
      nivelRiesgo: input.nivelRiesgo,
    };
  }
}
