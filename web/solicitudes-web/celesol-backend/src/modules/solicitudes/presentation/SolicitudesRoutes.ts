import { Router } from "express";

import type { SolicitudesController } from "./SolicitudesController";

/**
 * @openapi
 * tags:
 *   - name: Solicitudes Legacy
 *     description: Solicitudes backed by the legacy EvaluateList service.
 */
export class SolicitudesRoutes {
  static create(controller: SolicitudesController) {
    const router = Router();

    /**
     * @openapi
     * /solicitudes-legacy/precarga:
     *   get:
     *     summary: List current user's pending presolicitudes
     *     tags:
     *       - Solicitudes Legacy
     *     security:
     *       - accessTokenCookie: []
     *     parameters:
     *       - in: query
     *         name: max
     *         schema:
     *           type: integer
     *           default: 100
     *     responses:
     *       200:
     *         description: Mapped solicitudes for the authenticated legacy user.
     *       401:
     *         description: Invalid session.
     *       503:
     *         description: Legacy service unavailable.
     */
    router.get("/precarga", controller.precarga);

    /**
     * @openapi
     * /solicitudes-legacy/recientes:
     *   get:
     *     summary: List current user's recent solicitudes
     *     tags:
     *       - Solicitudes Legacy
     *     security:
     *       - accessTokenCookie: []
     *     parameters:
     *       - in: query
     *         name: max
     *         schema:
     *           type: integer
     *           default: 100
     *     responses:
     *       200:
     *         description: Mapped recent solicitudes for the authenticated legacy user.
     *       401:
     *         description: Invalid session.
     *       503:
     *         description: Legacy service unavailable.
     */
    router.get("/recientes", controller.recientes);

    /**
     * @openapi
     * /solicitudes-legacy/historicas:
     *   get:
     *     summary: List current user's historical solicitudes
     *     tags:
     *       - Solicitudes Legacy
     *     security:
     *       - accessTokenCookie: []
     *     parameters:
     *       - in: query
     *         name: max
     *         schema:
     *           type: integer
     *           default: 90000
     *     responses:
     *       200:
     *         description: Mapped historical solicitudes for the authenticated legacy user.
     *       401:
     *         description: Invalid session.
     *       503:
     *         description: Legacy service unavailable.
     */
    router.get("/historicas", controller.historicas);

    /**
     * @openapi
     * /solicitudes-legacy/detalle:
     *   get:
     *     summary: Get solicitud detail by number
     *     tags:
     *       - Solicitudes Legacy
     *     security:
     *       - accessTokenCookie: []
     *     parameters:
     *       - in: query
     *         name: nroSolicitud
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Mapped solicitud details.
     *       400:
     *         description: Invalid query.
     *       401:
     *         description: Invalid session.
     *       503:
     *         description: Legacy service unavailable.
     */
    router.get("/detalle", controller.detalle);

    /**
     * @openapi
     * /solicitudes-legacy/detail:
     *   get:
     *     summary: Get unified solicitud detail by OID
     *     tags:
     *       - Solicitudes Legacy
     *     security:
     *       - accessTokenCookie: []
     *     parameters:
     *       - in: query
     *         name: oid
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Mapped unified solicitud detail.
     *       400:
     *         description: Invalid query.
     *       401:
     *         description: Invalid session.
     *       404:
     *         description: Solicitud not found.
     *       503:
     *         description: Legacy service unavailable.
     */
    router.get("/detail", controller.detail);

    /**
     * @openapi
     * /solicitudes-legacy/socio:
     *   get:
     *     summary: Get mutual member by DNI
     *     tags:
     *       - Solicitudes Legacy
     *     security:
     *       - accessTokenCookie: []
     *     parameters:
     *       - in: query
     *         name: dni
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Mapped mutual member rows.
     *       400:
     *         description: Invalid query.
     *       401:
     *         description: Invalid session.
     *       503:
     *         description: Legacy service unavailable.
     */
    router.get("/socio", controller.socio);

    /**
     * @openapi
     * /solicitudes-legacy/lineas-prestamo:
     *   get:
     *     summary: Get loan lines by agent
     *     tags:
     *       - Solicitudes Legacy
     *     security:
     *       - accessTokenCookie: []
     *     responses:
     *       200:
     *         description: Mapped loan line rows for the authenticated user.
     *       400:
     *         description: Invalid query.
     *       401:
     *         description: Invalid session.
     *       503:
     *         description: Legacy service unavailable.
     */
    router.get("/lineas-prestamo", controller.lineasPrestamo);

    /**
     * @openapi
     * /solicitudes-legacy/socios-cancelaciones:
     *   get:
     *     summary: List mutual members eligible for cancelacion (category "OTROS (CANCELACIONES)")
     *     tags:
     *       - Solicitudes Legacy
     *     security:
     *       - accessTokenCookie: []
     *     responses:
     *       200:
     *         description: Mapped mutual member rows filtered by category.
     *       401:
     *         description: Invalid session.
     *       503:
     *         description: Legacy service unavailable.
     */
    router.get("/socios-cancelaciones", controller.sociosCancelaciones);

    /**
     * @openapi
     * /solicitudes-legacy/socios-cancelaciones/detalle:
     *   get:
     *     summary: Get mutual member detail by ID (cuenta bancaria habitual included)
     *     tags:
     *       - Solicitudes Legacy
     *     security:
     *       - accessTokenCookie: []
     *     parameters:
     *       - in: query
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Mapped mutual member detail.
     *       400:
     *         description: Invalid query.
     *       401:
     *         description: Invalid session.
     *       404:
     *         description: Socio not found.
     *       503:
     *         description: Legacy service unavailable.
     */
    router.get(
      "/socios-cancelaciones/detalle",
      controller.socioCancelacionDetalle,
    );

    return router;
  }
}
