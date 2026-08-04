import type { IdInput } from "../dtos/SolicitudesQuery.dto";
import type { SolicitudesLegacyGateway } from "../../domain/services/SolicitudesLegacyGateway";

type Dependencies = {
  solicitudesGateway: SolicitudesLegacyGateway;
};

export class GetSocioMutualCancelacionDetalleUseCase {
  private readonly solicitudesGateway: SolicitudesLegacyGateway;

  constructor(dependencies: Dependencies) {
    this.solicitudesGateway = dependencies.solicitudesGateway;
  }

  execute(input: IdInput) {
    return this.solicitudesGateway.getSocioMutualCancelacionDetalleById(
      input.id,
    );
  }
}
