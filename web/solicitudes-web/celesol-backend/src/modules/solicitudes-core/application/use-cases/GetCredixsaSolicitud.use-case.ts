import { buildConsultaCredixsa } from "../services/identificadorCredixsa";
import {
  desdeGuardado,
  estaVigente,
  paraGuardar,
} from "../services/informeCredixsaGuardado";
import type {
  ConsultarCredixsaGateway,
  InformeCredixsa,
} from "../../infrastructure/services/ConsultarCredixsaGateway";
import { SolicitudCoreNotFoundError } from "../../domain/solicitudes-core-errors";
import type { SolicitudCredixsaInformeRepository } from "../../domain/repositories/SolicitudCredixsaInformeRepository";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";

type Informes = Pick<
  SolicitudCredixsaInformeRepository,
  "findBySolicitudId" | "guardar"
>;

type Dependencies = {
  gateway: Pick<ConsultarCredixsaGateway, "obtenerInforme">;
  informes: Informes;
  now?: () => Date;
  repository: Pick<SolicitudesCoreRepository, "findById">;
  timeoutMs: number;
};

export type GetCredixsaSolicitudInput = {
  solicitudId: string;
};

export class GetCredixsaSolicitudUseCase {
  private readonly gateway: Pick<ConsultarCredixsaGateway, "obtenerInforme">;
  private readonly informes: Informes;
  private readonly now: () => Date;
  private readonly repository: Pick<SolicitudesCoreRepository, "findById">;
  private readonly timeoutMs: number;

  constructor(dependencies: Dependencies) {
    this.gateway = dependencies.gateway;
    this.informes = dependencies.informes;
    this.now = dependencies.now ?? (() => new Date());
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

    const ahora = this.now();
    const guardado = await this.informes.findBySolicitudId(solicitud.id);

    // El caso normal: la consulta al crear la solicitud ya lo dejo guardado.
    if (guardado && estaVigente(guardado, ahora)) {
      return desdeGuardado(guardado);
    }

    // No hay informe guardado (solicitudes anteriores a esto, o la consulta
    // al crear no llego a guardarlo) o ya vencio: se consulta en el momento.
    //
    // Mismo criterio de identificador que la consulta al crear: si
    // difirieran, cada una usaria otra clave de la cache de Kestra y esta
    // pediria un scraping nuevo cada vez.
    const informe = await this.gateway.obtenerInforme(
      { ...buildConsultaCredixsa(solicitud.titular), solicitudId: solicitud.id },
      this.timeoutMs,
    );
    const nuevo = paraGuardar(informe, ahora);

    if (nuevo) {
      // Si falla el guardado el analista ve el informe igual; la proxima vez
      // que abra la pestaña se vuelve a consultar.
      await this.informes.guardar(solicitud.id, nuevo).catch((error: unknown) => {
        console.error("credixsa_informe_guardar_failed", {
          message: error instanceof Error ? error.message : String(error),
          solicitudId: solicitud.id,
        });
      });

      return informe;
    }

    // Kestra no respondio: mejor el informe vencido que nada. La pestaña
    // muestra su fecha, asi que no pasa por uno reciente.
    if (!informe && guardado) {
      return desdeGuardado(guardado);
    }

    return informe;
  }
}
