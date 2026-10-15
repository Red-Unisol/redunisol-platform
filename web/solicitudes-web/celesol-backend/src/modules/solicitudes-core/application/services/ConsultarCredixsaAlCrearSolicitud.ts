import {
  buildConsultaCredixsa,
  type TitularParaCredixsa,
} from "./identificadorCredixsa";
import { paraGuardar } from "./informeCredixsaGuardado";
import type { SolicitudCredixsaInformeRepository } from "../../domain/repositories/SolicitudCredixsaInformeRepository";
import type { ConsultarCredixsaGateway } from "../../infrastructure/services/ConsultarCredixsaGateway";

type Dependencies = {
  gateway: Pick<ConsultarCredixsaGateway, "obtenerInforme">;
  informes: Pick<SolicitudCredixsaInformeRepository, "guardar">;
  now?: () => Date;
  timeoutMs: number;
};

/**
 * Consulta CredixSA al crear una solicitud y guarda el informe, para que el
 * analista lo encuentre listo al abrir la pestaña. No es una capa extra: es la
 * misma consulta que haria el, hecha antes -- lo que cambia es quien espera el
 * scraping.
 *
 * Corre en segundo plano y puede tardar minutos, entre la cola del envoltorio
 * de Kestra y el scraping. Si no llega a guardar nada, la pestaña consulta en
 * el momento.
 */
export class ConsultarCredixsaAlCrearSolicitud {
  private readonly gateway: Pick<ConsultarCredixsaGateway, "obtenerInforme">;
  private readonly informes: Pick<SolicitudCredixsaInformeRepository, "guardar">;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(dependencies: Dependencies) {
    this.gateway = dependencies.gateway;
    this.informes = dependencies.informes;
    this.now = dependencies.now ?? (() => new Date());
    this.timeoutMs = dependencies.timeoutMs;
  }

  async execute(solicitudId: string, titular: TitularParaCredixsa) {
    const informe = await this.gateway.obtenerInforme(
      {
        ...buildConsultaCredixsa(titular),
        solicitudId,
      },
      this.timeoutMs,
    );
    const guardado = paraGuardar(informe, this.now());

    if (guardado) {
      await this.informes.guardar(solicitudId, guardado);
    }
  }
}
