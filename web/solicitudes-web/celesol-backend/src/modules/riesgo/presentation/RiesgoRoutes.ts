import { Router } from "express";

import type { RiesgoController } from "./RiesgoController";

export class RiesgoRoutes {
  static create(controller: RiesgoController) {
    const router = Router();

    router.get("/calculadora", controller.getCalculadora);
    router.get(
      "/calculadora/core/:solicitudId/datos",
      controller.getCalculadoraDatosByCoreId,
    );
    router.get("/calculadora/:oid/datos", controller.getCalculadoraDatos);

    return router;
  }
}
