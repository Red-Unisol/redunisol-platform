import {
  SolicitudCoreNotFoundError,
  SolicitudMontoReciboRequiredForWorkflowError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";

type Dependencies = {
  solicitudesRepository: SolicitudesCoreRepository;
};

export class EnsureSolicitudHasMontoRecibo {
  private readonly solicitudesRepository: SolicitudesCoreRepository;

  constructor(dependencies: Dependencies) {
    this.solicitudesRepository = dependencies.solicitudesRepository;
  }

  async execute(solicitudId: string): Promise<void> {
    const solicitud = await this.solicitudesRepository.findById(solicitudId);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    // Cero cuenta como vacio: un recibo en 0 no le sirve a Riesgo para
    // evaluar los ingresos.
    const montoRecibo = solicitud.datosLaborales?.montoRecibo ?? null;

    if (montoRecibo === null || montoRecibo <= 0) {
      throw new SolicitudMontoReciboRequiredForWorkflowError();
    }
  }
}
