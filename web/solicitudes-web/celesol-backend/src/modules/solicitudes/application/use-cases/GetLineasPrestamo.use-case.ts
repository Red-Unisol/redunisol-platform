import type { LegacyUserInput } from "../dtos/SolicitudesQuery.dto";
import type { SolicitudesLegacyGateway } from "../../domain/services/SolicitudesLegacyGateway";

type Dependencies = {
  solicitudesGateway: SolicitudesLegacyGateway;
};

export class GetLineasPrestamoUseCase {
  private readonly solicitudesGateway: SolicitudesLegacyGateway;

  constructor(dependencies: Dependencies) {
    this.solicitudesGateway = dependencies.solicitudesGateway;
  }

  execute(input: LegacyUserInput) {
    return this.solicitudesGateway.getLineasPrestamoByLegacyUser(
      input.legacyUser,
    );
  }
}
