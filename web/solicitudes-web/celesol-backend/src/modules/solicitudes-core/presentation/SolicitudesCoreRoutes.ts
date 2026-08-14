import { Router } from "express";

import type { SolicitudAdjuntosController } from "../adjuntos/presentation/SolicitudAdjuntosController";
import { SolicitudAdjuntosRoutes } from "../adjuntos/presentation/SolicitudAdjuntosRoutes";
import type { SolicitudCancelacionesController } from "../cancelaciones/presentation/SolicitudCancelacionesController";
import { SolicitudCancelacionesRoutes } from "../cancelaciones/presentation/SolicitudCancelacionesRoutes";
import type { SolicitudesCoreController } from "./SolicitudesCoreController";

export class SolicitudesCoreRoutes {
  static create(
    controller: SolicitudesCoreController,
    solicitudAdjuntosController: SolicitudAdjuntosController,
    solicitudCancelacionesController: SolicitudCancelacionesController,
  ) {
    const router = Router();

    router.post("/", controller.create);
    router.get("/", controller.list);
    router.get("/stats", controller.getStats);
    router.get("/stats/vendedor", controller.getVendedorStats);
    router.get("/stats/analista", controller.getAnalistaStats);
    router.get("/stats/analista/v2", controller.getAnalistaStatsV2);
    router.post("/simulacion", controller.simular);
    router.get("/tipos-adjunto", solicitudAdjuntosController.listTiposAdjunto);

    router.get("/:id/transitions", controller.listTransitions);
    router.post("/:id/transitions", controller.changeState);
    router.post("/:id/prestamo-legacy", controller.createPrestamoLegacy);
    router.get("/:id/assignment/agents", controller.listAssignableAgents);
    router.post("/:id/assignment/self", controller.assignToSelf);
    router.post("/:id/assignment", controller.assignToUser);
    router.get("/:id/history", controller.listHistory);
    router.get("/:id", controller.getById);
    router.patch("/:id", controller.update);
    router.use("/", SolicitudAdjuntosRoutes.create(solicitudAdjuntosController));
    router.use(
      "/",
      SolicitudCancelacionesRoutes.create(solicitudCancelacionesController),
    );

    return router;
  }
}
