import { FindSolicitudTitularSocioLegacyId } from "../services/FindSolicitudTitularSocioLegacyId";
import type {
  CuotaPrestamoLegacy,
  PrestamoDelSocioDetalleLegacy,
} from "../../../solicitudes/domain/entities/Solicitud.entity";
import {
  PrestamoDelSocioNotFoundError,
  SolicitudCoreNotFoundError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { SolicitudesLegacyGateway } from "../../../solicitudes/domain/services/SolicitudesLegacyGateway";

type LegacyGateway = Pick<
  SolicitudesLegacyGateway,
  "getPrestamoDelSocio" | "listCuotasDelPrestamo"
> & {
  lookupSocioRapido(
    documento: string,
    tipoDocumento?: string,
  ): Promise<{ id: string }[]>;
};

type Dependencies = {
  legacyGateway: LegacyGateway;
  repository: Pick<SolicitudesCoreRepository, "findById">;
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

    // El socio se busca en Vimarx, igual que en la lista de prestamos.
    const socioLegacyId = await this.findSocioLegacyId.execute(
      solicitud.titular,
    );

    // Un titular que no es socio no tiene prestamos: para quien pregunta es lo
    // mismo que pedir un prestamo ajeno.
    if (!socioLegacyId) {
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
