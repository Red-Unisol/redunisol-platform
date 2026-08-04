import multer from "multer";
import { Router } from "express";

import { MAX_ADJUNTOS_LOTE } from "../domain/TiposAdjuntoCatalog";
import type { SolicitudAdjuntosController } from "./SolicitudAdjuntosController";

export class SolicitudAdjuntosRoutes {
  static create(controller: SolicitudAdjuntosController) {
    const router = Router();
    const upload = multer({
      storage: multer.memoryStorage(),
    });

    router.post("/:id/adjuntos", upload.single("file"), controller.upload);
    router.post(
      "/:id/adjuntos/batch",
      upload.array("files", MAX_ADJUNTOS_LOTE),
      controller.uploadBatch,
    );
    router.get("/:id/adjuntos", controller.list);

    router.get("/:id/adjuntos/:adjuntoId/download", controller.download);

    router.patch("/:id/adjuntos/:adjuntoId", controller.patch);
    router.delete("/:id/adjuntos/:adjuntoId", controller.delete);

    return router;
  }
}
