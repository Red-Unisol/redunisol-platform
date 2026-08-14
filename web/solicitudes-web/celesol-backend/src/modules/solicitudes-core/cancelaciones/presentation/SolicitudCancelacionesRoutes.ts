import { Router } from "express";

import type { SolicitudCancelacionesController } from "./SolicitudCancelacionesController";

export class SolicitudCancelacionesRoutes {
  static create(controller: SolicitudCancelacionesController) {
    const router = Router();

    router.get("/:id/cancelaciones", controller.list);
    router.post("/:id/cancelaciones", controller.create);
    router.patch("/:id/cancelaciones/:cancelacionId", controller.patch);
    router.delete("/:id/cancelaciones/:cancelacionId", controller.delete);

    return router;
  }
}
