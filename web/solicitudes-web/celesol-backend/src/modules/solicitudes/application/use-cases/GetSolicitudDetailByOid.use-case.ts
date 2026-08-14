import type { SolicitudDetailByOidInput } from "../dtos/SolicitudesQuery.dto";
import { SolicitudNotFoundError } from "../../domain/solicitudes-errors";
import type { SolicitudesLegacyGateway } from "../../domain/services/SolicitudesLegacyGateway";

type Dependencies = {
  solicitudesGateway: SolicitudesLegacyGateway;
};

export class GetSolicitudDetailByOidUseCase {
  private readonly solicitudesGateway: SolicitudesLegacyGateway;

  constructor(dependencies: Dependencies) {
    this.solicitudesGateway = dependencies.solicitudesGateway;
  }

  async execute(input: SolicitudDetailByOidInput) {
    const rows = await this.solicitudesGateway.getDetailByOid(input.oid);
    const detail = rows[0];

    if (!detail) {
      throw new SolicitudNotFoundError();
    }

    return detail;
  }
}
