import { CalculoConValoresEfectivosError } from "../../domain/solicitudes-core-errors";
import { ajustarMaximosLinea } from "../services/AjustarMaximosLinea";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import { SolicitudCoreNotFoundError } from "../../domain/solicitudes-core-errors";
import type {
  PrestamosSimulacionGateway,
  SimulacionPrestamo,
} from "../../../solicitudes/infrastructure/services/PrestamosSimulacionGateway";
import { LegacyLineaPrestamoUnavailableError } from "../../domain/solicitudes-core-errors";
import type { LineasPrestamoCatalog } from "../../domain/services/LineasPrestamoCatalog";

export type SimularPrestamoUseCaseInput = {
  solicitudId?: string;
  capitalPuro: boolean;
  cuotas: number;
  fechaPrimerVencimiento?: string;
  legacyUser: string;
  lineaId: number;
  montoAFinanciar: number;
  tasa?: number;
};

type Dependencies = {
  repository: Pick<
    SolicitudesCoreRepository,
    "findById" | "findVendedorLegacyUser"
  >;
  gateway: PrestamosSimulacionGateway;
  lineasPrestamoCatalog: LineasPrestamoCatalog;
};

export class SimularPrestamoUseCase {
  private readonly repository: Dependencies["repository"];
  private readonly gateway: PrestamosSimulacionGateway;
  private readonly lineasPrestamoCatalog: LineasPrestamoCatalog;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
    this.gateway = dependencies.gateway;
    this.lineasPrestamoCatalog = dependencies.lineasPrestamoCatalog;
  }

  async execute(
    input: SimularPrestamoUseCaseInput,
  ): Promise<SimulacionPrestamo> {
    let legacyUser = input.legacyUser;
    if (input.solicitudId) {
      const solicitud = await this.repository.findById(input.solicitudId);
      if (!solicitud) throw new SolicitudCoreNotFoundError();
      const vendedor = await this.repository.findVendedorLegacyUser?.(
        solicitud.id,
      );
      if (!vendedor) throw new LegacyLineaPrestamoUnavailableError();
      legacyUser = vendedor;
    }
    const lineaPrestamo =
      await this.lineasPrestamoCatalog.findByLegacyUserAndOid(
        legacyUser,
        String(input.lineaId),
      );

    if (!lineaPrestamo || !lineaPrestamo.vigente) {
      throw new LegacyLineaPrestamoUnavailableError();
    }

    const efectivos = ajustarMaximosLinea(lineaPrestamo, input);
    let result: SimulacionPrestamo;
    try {
      result = await this.gateway.simular({
        capitalPuro: input.capitalPuro,
        cuotas: efectivos.cuotas as number,
        fechaPrimerVencimiento: input.fechaPrimerVencimiento,
        lineaId: input.lineaId,
        montoAFinanciar: efectivos.montoAFinanciar as number,
        tasa: input.tasa,
      });
    } catch (error) {
      const domainError = error as { message?: string; statusCode?: number };
      throw new CalculoConValoresEfectivosError(
        efectivos as { montoAFinanciar: number; cuotas: number },
        domainError.statusCode
          ? domainError.message
          : "No se pudo obtener el cálculo del legacy.",
        domainError.statusCode ?? 503,
      );
    }
    if (
      !Number.isFinite(result.cuotaResultante) ||
      result.cuotas !== efectivos.cuotas ||
      result.montoAFinanciar !== efectivos.montoAFinanciar ||
      result.lineaId !== input.lineaId
    ) {
      throw new CalculoConValoresEfectivosError(
        efectivos as { montoAFinanciar: number; cuotas: number },
      );
    }
    return result;
  }
}
