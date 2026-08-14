import type { DniInput } from "../dtos/SolicitudesQuery.dto";
import type { SolicitudesLegacyGateway } from "../../domain/services/SolicitudesLegacyGateway";

type Dependencies = {
  solicitudesGateway: SolicitudesLegacyGateway;
};

export class GetSocioMutualUseCase {
  private readonly solicitudesGateway: SolicitudesLegacyGateway;

  constructor(dependencies: Dependencies) {
    this.solicitudesGateway = dependencies.solicitudesGateway;
  }

  execute(input: DniInput) {
    return this.solicitudesGateway.getSocioByDni(input.dni);
  }
}
