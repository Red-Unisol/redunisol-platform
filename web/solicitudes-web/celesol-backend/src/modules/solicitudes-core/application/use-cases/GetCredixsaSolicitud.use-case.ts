import { buildConsultaCredixsa } from "../services/identificadorCredixsa";
import type {
  ConsultarCredixsaGateway,
  InformeCredixsa,
} from "../../infrastructure/services/ConsultarCredixsaGateway";
import { SolicitudCoreNotFoundError } from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";

type Dependencies = {
  gateway: Pick<ConsultarCredixsaGateway, "obtenerInforme">;
  repository: Pick<SolicitudesCoreRepository, "findById">;
  timeoutMs: number;
};

export type GetCredixsaSolicitudInput = {
  solicitudId: string;
};

export class GetCredixsaSolicitudUseCase {
  private readonly gateway: Pick<ConsultarCredixsaGateway, "obtenerInforme">;
  private readonly repository: Pick<SolicitudesCoreRepository, "findById">;
  private readonly timeoutMs: number;

  constructor(dependencies: Dependencies) {
    this.gateway = dependencies.gateway;
    this.repository = dependencies.repository;
    this.timeoutMs = dependencies.timeoutMs;
  }

  async execute(
    input: GetCredixsaSolicitudInput,
  ): Promise<InformeCredixsa | null> {
    const solicitud = await this.repository.findById(input.solicitudId);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    // Mismo criterio que la consulta que se dispara al crear la solicitud: si
    // difirieran, cada una guardaria el informe bajo otra clave de cache y
    // esta pediria un scraping nuevo cada vez.
    return this.gateway.obtenerInforme(
      { ...buildConsultaCredixsa(solicitud.titular), solicitudId: solicitud.id },
      this.timeoutMs,
    );
  }
}
