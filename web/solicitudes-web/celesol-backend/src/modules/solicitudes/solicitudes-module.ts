import { env } from "../../config/env";
import type { GetCurrentUserUseCase } from "../auth/application/use-cases/GetCurrentUser.use-case";
import { GetLineasPrestamoUseCase } from "./application/use-cases/GetLineasPrestamo.use-case";
import { GetSocioMutualCancelacionDetalleUseCase } from "./application/use-cases/GetSocioMutualCancelacionDetalle.use-case";
import { GetSocioMutualUseCase } from "./application/use-cases/GetSocioMutual.use-case";
import { GetSolicitudDetalleUseCase } from "./application/use-cases/GetSolicitudDetalle.use-case";
import { GetSolicitudDetailByOidUseCase } from "./application/use-cases/GetSolicitudDetailByOid.use-case";
import { GetSolicitudesHistoricasUseCase } from "./application/use-cases/GetSolicitudesHistoricas.use-case";
import { GetSolicitudesPrecargaUseCase } from "./application/use-cases/GetSolicitudesPrecarga.use-case";
import { GetSolicitudesRecientesUseCase } from "./application/use-cases/GetSolicitudesRecientes.use-case";
import { ListSociosCancelacionesUseCase } from "./application/use-cases/ListSociosCancelaciones.use-case";
import { EvaluateListSolicitudesGateway } from "./infrastructure/services/EvaluateListSolicitudesGateway";
import { SolicitudesController } from "./presentation/SolicitudesController";
import { SolicitudesRoutes } from "./presentation/SolicitudesRoutes";

type CreateSolicitudesRouterDependencies = {
  getCurrentUserUseCase: GetCurrentUserUseCase;
};

export function createSolicitudesRouter(
  dependencies: CreateSolicitudesRouterDependencies,
) {
  const solicitudesGateway = new EvaluateListSolicitudesGateway({
    baseUrl: env.LEGACY_API_BASE_URL,
    timeoutMs: env.LEGACY_API_TIMEOUT_MS,
  });

  const getSolicitudesPrecargaUseCase = new GetSolicitudesPrecargaUseCase({
    solicitudesGateway,
  });
  const getSolicitudesRecientesUseCase = new GetSolicitudesRecientesUseCase({
    solicitudesGateway,
  });
  const getSolicitudesHistoricasUseCase = new GetSolicitudesHistoricasUseCase({
    solicitudesGateway,
  });
  const getSolicitudDetalleUseCase = new GetSolicitudDetalleUseCase({
    solicitudesGateway,
  });
  const getSolicitudDetailByOidUseCase = new GetSolicitudDetailByOidUseCase({
    solicitudesGateway,
  });
  const getSocioMutualUseCase = new GetSocioMutualUseCase({
    solicitudesGateway,
  });
  const getLineasPrestamoUseCase = new GetLineasPrestamoUseCase({
    solicitudesGateway,
  });
  const getSocioMutualCancelacionDetalleUseCase =
    new GetSocioMutualCancelacionDetalleUseCase({
      solicitudesGateway,
    });
  const listSociosCancelacionesUseCase = new ListSociosCancelacionesUseCase({
    solicitudesGateway,
  });

  const solicitudesController = new SolicitudesController({
    getCurrentUserUseCase: dependencies.getCurrentUserUseCase,
    getLineasPrestamoUseCase,
    getSocioMutualCancelacionDetalleUseCase,
    getSocioMutualUseCase,
    getSolicitudDetalleUseCase,
    getSolicitudDetailByOidUseCase,
    getSolicitudesHistoricasUseCase,
    getSolicitudesPrecargaUseCase,
    getSolicitudesRecientesUseCase,
    listSociosCancelacionesUseCase,
  });

  return SolicitudesRoutes.create(solicitudesController);
}

export const createSolicitudesLegacyRouter = createSolicitudesRouter;
