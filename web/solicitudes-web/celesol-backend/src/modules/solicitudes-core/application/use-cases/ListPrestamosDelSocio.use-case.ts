import { FindSolicitudTitularSocioLegacyId } from "../services/FindSolicitudTitularSocioLegacyId";
import type { PrestamoDelSocioLegacy } from "../../../solicitudes/domain/entities/Solicitud.entity";
import { SolicitudCoreNotFoundError } from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { SolicitudesLegacyGateway } from "../../../solicitudes/domain/services/SolicitudesLegacyGateway";

type LegacyGateway = Pick<SolicitudesLegacyGateway, "listPrestamosDelSocio"> & {
  lookupSocioRapido(
    documento: string,
    tipoDocumento?: string,
  ): Promise<{ id: string }[]>;
};

type Dependencies = {
  legacyGateway: LegacyGateway;
  repository: Pick<SolicitudesCoreRepository, "findById">;
};

export type ListPrestamosDelSocioInput = {
  solicitudId: string;
};

export class ListPrestamosDelSocioUseCase {
  private readonly findSocioLegacyId: FindSolicitudTitularSocioLegacyId;
  private readonly legacyGateway: LegacyGateway;
  private readonly repository: Pick<SolicitudesCoreRepository, "findById">;

  constructor(dependencies: Dependencies) {
    this.findSocioLegacyId = new FindSolicitudTitularSocioLegacyId({
      gateway: dependencies.legacyGateway,
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

    // El socio se busca en Vimarx, no en la tabla local: es lo mismo que ve
    // el modulo de prestamos de Vimarx al buscar por documento.
    const socioLegacyId = await this.findSocioLegacyId.execute(
      solicitud.titular,
    );

    // Sin socio en el padron no hay a quien preguntarle por sus prestamos. Es
    // un caso normal -- un titular que todavia no es socio -- asi que devuelve
    // vacio en vez de fallar.
    if (!socioLegacyId) {
      return [];
    }

    return this.legacyGateway.listPrestamosDelSocio(socioLegacyId);
  }
}
