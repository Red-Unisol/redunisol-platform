import { FindSolicitudTitularSocio } from "../services/FindSolicitudTitularSocio";
import type {
  CuotaPrestamoLegacy,
  PrestamoDelSocioDetalleLegacy,
} from "../../../solicitudes/domain/entities/Solicitud.entity";
import {
  PrestamoDelSocioNotFoundError,
  SolicitudCoreNotFoundError,
} from "../../domain/solicitudes-core-errors";
import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { SolicitudesLegacyGateway } from "../../../solicitudes/domain/services/SolicitudesLegacyGateway";

type LegacyGateway = Pick<
  SolicitudesLegacyGateway,
  "getPrestamoDelSocio" | "listCuotasDelPrestamo"
>;

type Dependencies = {
  legacyGateway: LegacyGateway;
  repository: Pick<SolicitudesCoreRepository, "findById">;
  sociosRepository: SocioRepository;
};

export type GetPrestamoDelSocioInput = {
  prestamoId: string;
  solicitudId: string;
};

export type PrestamoDelSocioConCuotas = {
  cuotas: CuotaPrestamoLegacy[];
  prestamo: PrestamoDelSocioDetalleLegacy;
};

export class GetPrestamoDelSocioUseCase {
  private readonly findSolicitudTitularSocio: FindSolicitudTitularSocio;
  private readonly legacyGateway: LegacyGateway;
  private readonly repository: Pick<SolicitudesCoreRepository, "findById">;

  constructor(dependencies: Dependencies) {
    this.findSolicitudTitularSocio = new FindSolicitudTitularSocio({
      sociosRepository: dependencies.sociosRepository,
    });
    this.legacyGateway = dependencies.legacyGateway;
    this.repository = dependencies.repository;
  }

  async execute(
    input: GetPrestamoDelSocioInput,
  ): Promise<PrestamoDelSocioConCuotas> {
    const solicitud = await this.repository.findById(input.solicitudId);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    // Los dos numeros se interpolan en la expresion de criterios del legado,
    // asi que solo se aceptan si son enteros.
    const prestamoId = input.prestamoId.trim();

    if (!/^\d+$/.test(prestamoId)) {
      throw new PrestamoDelSocioNotFoundError();
    }

    const socio = await this.findSolicitudTitularSocio.execute(
      solicitud.titular,
    );
    const socioLegacyId = socio?.nroSocioLegacy?.trim() ?? "";

    // Un titular que no es socio no tiene prestamos: para quien pregunta es lo
    // mismo que pedir un prestamo ajeno.
    if (!/^\d+$/.test(socioLegacyId)) {
      throw new PrestamoDelSocioNotFoundError();
    }

    // Primero el prestamo, filtrado por el socio del titular: si no es suyo,
    // no se llegan a pedir las cuotas.
    const prestamo = await this.legacyGateway.getPrestamoDelSocio(
      socioLegacyId,
      prestamoId,
    );

    if (!prestamo) {
      throw new PrestamoDelSocioNotFoundError();
    }

    const cuotas = await this.legacyGateway.listCuotasDelPrestamo(prestamoId);

    return { cuotas, prestamo };
  }
}
