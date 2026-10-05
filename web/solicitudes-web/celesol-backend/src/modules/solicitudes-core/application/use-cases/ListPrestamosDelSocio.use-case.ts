import { FindSolicitudTitularSocio } from "../services/FindSolicitudTitularSocio";
import type { PrestamoDelSocioLegacy } from "../../../solicitudes/domain/entities/Solicitud.entity";
import { SolicitudCoreNotFoundError } from "../../domain/solicitudes-core-errors";
import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { SolicitudesLegacyGateway } from "../../../solicitudes/domain/services/SolicitudesLegacyGateway";

type Dependencies = {
  legacyGateway: Pick<SolicitudesLegacyGateway, "listPrestamosDelSocio">;
  repository: Pick<SolicitudesCoreRepository, "findById">;
  sociosRepository: SocioRepository;
};

export type ListPrestamosDelSocioInput = {
  solicitudId: string;
};

export class ListPrestamosDelSocioUseCase {
  private readonly findSolicitudTitularSocio: FindSolicitudTitularSocio;
  private readonly legacyGateway: Pick<
    SolicitudesLegacyGateway,
    "listPrestamosDelSocio"
  >;
  private readonly repository: Pick<SolicitudesCoreRepository, "findById">;

  constructor(dependencies: Dependencies) {
    this.findSolicitudTitularSocio = new FindSolicitudTitularSocio({
      sociosRepository: dependencies.sociosRepository,
    });
    this.legacyGateway = dependencies.legacyGateway;
    this.repository = dependencies.repository;
  }

  async execute(
    input: ListPrestamosDelSocioInput,
  ): Promise<PrestamoDelSocioLegacy[]> {
    const solicitud = await this.repository.findById(input.solicitudId);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    const socio = await this.findSolicitudTitularSocio.execute(
      solicitud.titular,
    );

    // Sin socio en el padron, o sin numero en el legado, no hay a quien
    // preguntarle por sus prestamos. Es un caso normal -- un titular que
    // todavia no es socio -- asi que devuelve vacio en vez de fallar.
    if (!socio?.nroSocioLegacy) {
      return [];
    }

    // El numero se interpola en la expresion de criterios del legado, asi que
    // solo se acepta si es un entero. Cualquier otra cosa se descarta antes de
    // armar la consulta.
    if (!/^\d+$/.test(socio.nroSocioLegacy.trim())) {
      return [];
    }

    return this.legacyGateway.listPrestamosDelSocio(
      socio.nroSocioLegacy.trim(),
    );
  }
}
