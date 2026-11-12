import { FindSolicitudTitularSocioLegacyId } from "../services/FindSolicitudTitularSocioLegacyId";
import type {
  CuotaPrestamoLegacy,
  MovimientoCuotaLegacy,
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
  "getPrestamoDelSocio" | "listCuotasDelPrestamo" | "listMovimientosDeCuota"
> & {
  lookupSocioRapido(
    documento: string,
    tipoDocumento?: string,
    cuit?: string,
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

export type GetMovimientosDeCuotaInput = GetPrestamoDelSocioInput & {
  cuotaId: string;
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
    const { prestamo, prestamoId } = await this.prestamoDelTitular(input);
    const cuotas = await this.legacyGateway.listCuotasDelPrestamo(prestamoId);

    return { cuotas, prestamo };
  }

  // Movimientos de una cuota, para la ventana que se abre desde el plan de
  // cuotas. Mismo control que el detalle: solo cuotas de un prestamo del socio.
  async movimientosDeCuota(
    input: GetMovimientosDeCuotaInput,
  ): Promise<MovimientoCuotaLegacy[]> {
    // Tambien se interpola en la expresion de criterios del legado.
    const cuotaId = input.cuotaId.trim();

    if (!/^\d+$/.test(cuotaId)) {
      throw new PrestamoDelSocioNotFoundError();
    }

    const { prestamoId } = await this.prestamoDelTitular(input);

    return this.legacyGateway.listMovimientosDeCuota(prestamoId, cuotaId);
  }

  private async prestamoDelTitular(input: GetPrestamoDelSocioInput) {
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
    // no se llega a pedir nada mas.
    const prestamo = await this.legacyGateway.getPrestamoDelSocio(
      socioLegacyId,
      prestamoId,
    );

    if (!prestamo) {
      throw new PrestamoDelSocioNotFoundError();
    }

    return { prestamo, prestamoId };
  }
}
