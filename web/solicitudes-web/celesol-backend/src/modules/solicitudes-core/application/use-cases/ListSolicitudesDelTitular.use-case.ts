import type { AuthUser } from "../../../auth/domain/entities/User.entity";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { HistorialSolicitudesGateway } from "../../domain/services/HistorialSolicitudesGateway";
import {
  ForbiddenSolicitudAccessError,
  SolicitudCoreNotFoundError,
} from "../../domain/solicitudes-core-errors";
import { canViewSolicitud } from "../services/SolicitudPermissions";

export class ListSolicitudesDelTitularUseCase {
  constructor(
    private readonly deps: {
      repository: Pick<SolicitudesCoreRepository, "findById">;
      legacyGateway: HistorialSolicitudesGateway;
    },
  ) {}

  async execute(input: { solicitudId: string; currentUser: AuthUser }) {
    if (
      !input.currentUser.isSystemAdmin &&
      input.currentUser.workflowOwner?.code === "VENDEDORES"
    ) {
      throw new ForbiddenSolicitudAccessError();
    }
    const solicitud = await this.deps.repository.findById(input.solicitudId);
    if (!solicitud) throw new SolicitudCoreNotFoundError();
    if (!canViewSolicitud(input.currentUser, solicitud))
      throw new ForbiddenSolicitudAccessError();
    const documento = solicitud.titular.nroDocumento?.trim() ?? "";
    if (!/^\d{1,12}$/.test(documento) || /^0+$/.test(documento)) {
      return {
        status: "documento_invalido" as const,
        solicitudes: [],
        limit: 50 as const,
      };
    }
    return {
      status: "ok" as const,
      solicitudes:
        await this.deps.legacyGateway.listSolicitudesDelTitular(documento),
      limit: 50 as const,
    };
  }
}
