import { SolicitudCoreNotFoundError } from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type {
  SolicitudRefinanciacion,
  SolicitudRefinanciacionRepository,
} from "../../domain/repositories/SolicitudRefinanciacionRepository";

type Dependencies = {
  refinanciacionRepository: Pick<
    SolicitudRefinanciacionRepository,
    "findBySolicitudId"
  >;
  repository: Pick<SolicitudesCoreRepository, "findById">;
};

// Las cuotas guardadas para refinanciar. Solo lo guardado en Sol Web: los
// importes salen de la simulacion, que pega a Vimarx en vivo.
export class GetSolicitudRefinanciacionUseCase {
  private readonly refinanciacionRepository: Dependencies["refinanciacionRepository"];
  private readonly repository: Dependencies["repository"];

  constructor(dependencies: Dependencies) {
    this.refinanciacionRepository = dependencies.refinanciacionRepository;
    this.repository = dependencies.repository;
  }

  async execute(input: { solicitudId: string }): Promise<SolicitudRefinanciacion> {
    const solicitud = await this.repository.findById(input.solicitudId);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    return this.refinanciacionRepository.findBySolicitudId(input.solicitudId);
  }
}
