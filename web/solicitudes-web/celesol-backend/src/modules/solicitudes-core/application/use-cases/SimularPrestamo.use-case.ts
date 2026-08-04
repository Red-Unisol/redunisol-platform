import type {
  PrestamosSimulacionGateway,
  SimulacionPrestamo,
} from "../../../solicitudes/infrastructure/services/PrestamosSimulacionGateway";
import { LegacyLineaPrestamoUnavailableError } from "../../domain/solicitudes-core-errors";
import type { LineasPrestamoCatalog } from "../../domain/services/LineasPrestamoCatalog";

export type SimularPrestamoUseCaseInput = {
  capitalPuro: boolean;
  cuotas: number;
  fechaPrimerVencimiento?: string;
  legacyUser: string;
  lineaId: number;
  montoAFinanciar: number;
  tasa?: number;
};

type Dependencies = {
  gateway: PrestamosSimulacionGateway;
  lineasPrestamoCatalog: LineasPrestamoCatalog;
};

export class SimularPrestamoUseCase {
  private readonly gateway: PrestamosSimulacionGateway;
  private readonly lineasPrestamoCatalog: LineasPrestamoCatalog;

  constructor(dependencies: Dependencies) {
    this.gateway = dependencies.gateway;
    this.lineasPrestamoCatalog = dependencies.lineasPrestamoCatalog;
  }

  async execute(input: SimularPrestamoUseCaseInput): Promise<SimulacionPrestamo> {
    const lineaPrestamo = await this.lineasPrestamoCatalog.findByLegacyUserAndOid(
      input.legacyUser,
      String(input.lineaId),
    );

    if (!lineaPrestamo || !lineaPrestamo.vigente) {
      throw new LegacyLineaPrestamoUnavailableError();
    }

    return this.gateway.simular({
      capitalPuro: input.capitalPuro,
      cuotas: input.cuotas,
      fechaPrimerVencimiento: input.fechaPrimerVencimiento,
      lineaId: input.lineaId,
      montoAFinanciar: input.montoAFinanciar,
      tasa: input.tasa,
    });
  }
}
