import { Router } from "express";

import type { SociosController } from "./SociosController";

export class SociosRoutes {
  static create(controller: SociosController) {
    const router = Router();

    router.post("/", controller.create);
    router.post("/sync-legacy", controller.syncFromLegacy);
    router.get("/lookup", controller.lookup);
    router.get("/check-cuit", controller.checkCuit);
    router.get("/check-documento", controller.checkDocumento);
    router.get("/", controller.list);
    router.get("/:id", controller.getById);
    router.patch("/:id", controller.update);
    router.delete("/:id", controller.delete);

    return router;
  }
}
