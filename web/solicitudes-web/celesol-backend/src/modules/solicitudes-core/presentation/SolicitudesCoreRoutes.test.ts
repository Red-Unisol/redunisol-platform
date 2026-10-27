import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SolicitudesCoreRoutes } from "./SolicitudesCoreRoutes";

describe("SolicitudesCoreRoutes", () => {
  it("registers workflow routes before the generic id routes", () => {
    const router = SolicitudesCoreRoutes.create(
      {
        assignToSelf: () => undefined,
        assignToUser: () => undefined,
        changeState: () => undefined,
        create: () => undefined,
        getRevisionPrestamo: () => undefined,
        createPrestamoLegacy: () => undefined,
        getById: () => undefined,
        getStats: () => undefined,
        getVendedorStats: () => undefined,
        getAnalistaStats: () => undefined,
        getAnalistaStatsV2: () => undefined,
        list: () => undefined,
        listAssignableAgents: () => undefined,
        listLineasPrestamo: () => undefined,
        getCredixsa: () => undefined,
        getPrestamoDelSocio: () => undefined,
        listSolicitudesDelTitular: () => undefined,
        listPrestamosDelSocio: () => undefined,
        listHistory: () => undefined,
        listTransitions: () => undefined,
        simular: () => undefined,
        simularRefinanciacion: () => undefined,
        update: () => undefined,
      } as never,
      {
        delete: () => undefined,
        download: () => undefined,
        list: () => undefined,
        listTiposAdjunto: () => undefined,
        patch: () => undefined,
        upload: () => undefined,
        uploadBatch: () => undefined,
      } as never,
      {
        create: () => undefined,
        delete: () => undefined,
        list: () => undefined,
        patch: () => undefined,
      } as never,
    );
    const routePaths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => layer.route?.path);

    assert.deepEqual(routePaths.slice(0, 25), [
      "/",
      "/",
      "/stats",
      "/stats/vendedor",
      "/stats/analista",
      "/stats/analista/v2",
      "/simulacion",
      "/tipos-adjunto",
      "/:id/simulacion",
      "/:id/transitions",
      "/:id/transitions",
      "/:id/revision-prestamo",
      "/:id/prestamo-legacy",
      "/:id/solicitudes-titular",
      "/:id/prestamos-socio",
      "/:id/prestamos-socio/:prestamoId",
      "/:id/refinanciacion/simulacion",
      "/:id/credixsa",
      "/:id/lineas-prestamo",
      "/:id/assignment/agents",
      "/:id/assignment/self",
      "/:id/assignment",
      "/:id/history",
      "/:id",
      "/:id",
    ]);
  });
});
