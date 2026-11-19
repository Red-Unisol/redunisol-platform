import { Router } from "express";

import type { RiesgoController } from "./RiesgoController";

export class RiesgoRoutes {
  static create(controller: RiesgoController) {
    const router = Router();

    router.get("/calculadora", controller.getCalculadora);
    router.get("/calculadora/versiones", controller.listarVersiones);
    router.post(
      "/calculadora/versiones/vista-previa",
      controller.previsualizarVersion,
    );
    router.post("/calculadora/versiones", controller.aplicarVersion);
    router.post(
      "/calculadora/versiones/:versionId/restaurar",
      controller.restaurarVersion,
    );
    router.get(
      "/calculadora/core/:solicitudId/datos",
      controller.getCalculadoraDatosByCoreId,
    );
    router.get(
      "/calculadora/core/:solicitudId/evaluacion",
      controller.getEvaluacion,
    );
    router.put(
      "/calculadora/core/:solicitudId/evaluacion",
      controller.guardarEvaluacion,
    );
    router.get("/calculadora/:oid/datos", controller.getCalculadoraDatos);

    return router;
  }
}
