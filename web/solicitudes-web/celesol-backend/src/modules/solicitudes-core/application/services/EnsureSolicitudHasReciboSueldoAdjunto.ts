import type { TipoAdjuntoValue } from "../../adjuntos/domain/TiposAdjuntoCatalog";
import type { SolicitudAdjuntoRepository } from "../../adjuntos/domain/repositories/SolicitudAdjuntoRepository";
import { SolicitudReciboSueldoAdjuntoRequiredForWorkflowError } from "../../domain/solicitudes-core-errors";

const RECIBO_SUELDO_TIPO_ADJUNTO: TipoAdjuntoValue = "Recibo de Sueldo";

type Dependencies = {
  adjuntoRepository: SolicitudAdjuntoRepository;
};

export class EnsureSolicitudHasReciboSueldoAdjunto {
  private readonly adjuntoRepository: SolicitudAdjuntoRepository;

  constructor(dependencies: Dependencies) {
    this.adjuntoRepository = dependencies.adjuntoRepository;
  }

  async check(solicitudId: string): Promise<boolean> {
    const adjuntos = await this.adjuntoRepository.listBySolicitudId(solicitudId);

    return adjuntos.some(
      (adjunto) =>
        adjunto.deletedAt === null &&
        adjunto.tipoAdjunto === RECIBO_SUELDO_TIPO_ADJUNTO,
    );
  }

  async execute(solicitudId: string): Promise<void> {
    const hasReciboSueldo = await this.check(solicitudId);

    if (!hasReciboSueldo) {
      throw new SolicitudReciboSueldoAdjuntoRequiredForWorkflowError();
    }
  }
}
