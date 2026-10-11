import type { Router } from "express";
import type { GetCurrentUserUseCase } from "../../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import type { GetSolicitudByIdUseCase } from "../application/use-cases/GetSolicitudById.use-case";
import type { GetDatosRapidosUseCase } from "../application/use-cases/GetDatosRapidos.use-case";
import { solicitudByIdParamsSchema } from "./SolicitudesCoreRequest.schema";
import { InvalidSolicitudesCoreRequestError } from "../domain/solicitudes-core-errors";

// Montar sobre el router existente: conserva su guard de visibilidad por solicitud.
export function addDatosRapidosRoutes(
  router: Router,
  dependencies: {
    getCurrentUserUseCase: GetCurrentUserUseCase;
    getSolicitudByIdUseCase: GetSolicitudByIdUseCase;
    datosRapidos: GetDatosRapidosUseCase;
  },
) {
  for (const parte of ["socio", "convenio", "creditos"] as const) {
    router.get(`/:id/datos-rapidos/${parte}`, async (req, res, next) => {
      try {
        const user = await dependencies.getCurrentUserUseCase.execute(
          req.cookies?.[ACCESS_TOKEN_COOKIE],
        );
        const params = solicitudByIdParamsSchema.safeParse(req.params);
        if (!params.success)
          throw new InvalidSolicitudesCoreRequestError("Solicitud inválida.");
        const solicitud = await dependencies.getSolicitudByIdUseCase.execute({
          id: params.data.id,
          currentUser: {
            id: user.id,
            workflowOwnerId: user.workflowOwnerId,
            isSystemAdmin: user.isSystemAdmin,
          },
        });
        res.setHeader("Cache-Control", "no-store");
        res.json(await dependencies.datosRapidos[parte](solicitud));
      } catch (error) {
        next(error);
      }
    });
  }
  return router;
}
