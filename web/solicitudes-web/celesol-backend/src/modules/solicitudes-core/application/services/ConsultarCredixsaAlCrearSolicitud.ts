import {
  buildConsultaCredixsa,
  type TitularParaCredixsa,
} from "./identificadorCredixsa";
import type { ConsultarCredixsaGateway } from "../../infrastructure/services/ConsultarCredixsaGateway";

type Dependencies = {
  gateway: Pick<ConsultarCredixsaGateway, "consultar">;
};

/**
 * Consulta CredixSA al crear una solicitud, para que el informe este cacheado
 * cuando el analista lo pida. No es una capa extra: es la misma consulta que
 * haria el, hecha antes -- lo que cambia es quien espera el scraping.
 */
export class ConsultarCredixsaAlCrearSolicitud {
  private readonly gateway: Pick<ConsultarCredixsaGateway, "consultar">;

  constructor(dependencies: Dependencies) {
    this.gateway = dependencies.gateway;
  }

  async execute(solicitudId: string, titular: TitularParaCredixsa) {
    await this.gateway.consultar({
      ...buildConsultaCredixsa(titular),
      solicitudId,
    });
  }
}
