import { Router } from "express";

import type { FinSolicitudController } from "./FinSolicitudController";

// Montado directo en app.ts, fuera de cualquier router autenticado -- este
// endpoint es publico a proposito (ver plan de integracion de firma
// electronica). No agregar aca ningun middleware de sesion/cookie.
export class FinSolicitudRoutes {
  static create(controller: FinSolicitudController) {
    const router = Router();

    router.post("/finSolicitud/:ntrans/:sol", controller.finSolicitud);

    return router;
  }
}
