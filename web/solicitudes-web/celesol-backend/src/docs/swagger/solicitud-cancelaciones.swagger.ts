/**
 * @openapi
 * tags:
 *   - name: Solicitudes Core Cancelaciones
 *     description: Cancelaciones asociadas a solicitudes propias.
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     SolicitudCancelacion:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         solicitudId:
 *           type: string
 *           format: uuid
 *         cuentaADebitar:
 *           type: string
 *         cbu:
 *           type: string
 *         cuentaBancaria:
 *           type: string
 *         socio:
 *           type: string
 *         socioLegacyId:
 *           type: string
 *           nullable: true
 *         monto:
 *           type: number
 *         notas:
 *           type: string
 *           nullable: true
 *         createdBy:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         createdByName:
 *           type: string
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         deletedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         deletedBy:
 *           type: string
 *           format: uuid
 *           nullable: true
 */

/**
 * @openapi
 * /solicitudes/{id}/cancelaciones:
 *   get:
 *     summary: List non-deleted cancelaciones for a first-party solicitud
 *     description: Lista solo cancelaciones no eliminadas logicamente.
 *     tags:
 *       - Solicitudes Core Cancelaciones
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Cancelacion list.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: "#/components/schemas/SolicitudCancelacion"
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Solicitud not found.
 *   post:
 *     summary: Create a cancelacion for a first-party solicitud
 *     description: |
 *       Registra una cancelacion asociada a la solicitud.
 *       Requiere que el usuario actual pertenezca al workflow owner del estado
 *       actual y que la regla de acceso a campos habilite `canManageAttachments`.
 *     tags:
 *       - Solicitudes Core Cancelaciones
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - cuentaADebitar
 *               - cbu
 *               - cuentaBancaria
 *               - socio
 *               - monto
 *             properties:
 *               cuentaADebitar:
 *                 type: string
 *               cbu:
 *                 type: string
 *               cuentaBancaria:
 *                 type: string
 *               socio:
 *                 type: string
 *               socioLegacyId:
 *                 type: string
 *               monto:
 *                 type: number
 *                 exclusiveMinimum: 0
 *               notas:
 *                 type: string
 *     responses:
 *       201:
 *         description: Cancelacion created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/SolicitudCancelacion"
 *       400:
 *         description: Invalid request body.
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Solicitud not found.
 */

/**
 * @openapi
 * /solicitudes/{id}/cancelaciones/{cancelacionId}:
 *   patch:
 *     summary: Update a cancelacion from a first-party solicitud
 *     description: |
 *       Actualiza parcialmente una cancelacion existente. Mismos requisitos de
 *       acceso que la creacion.
 *     tags:
 *       - Solicitudes Core Cancelaciones
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: cancelacionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               cuentaADebitar:
 *                 type: string
 *               cbu:
 *                 type: string
 *               cuentaBancaria:
 *                 type: string
 *               socio:
 *                 type: string
 *               socioLegacyId:
 *                 type: string
 *               monto:
 *                 type: number
 *                 exclusiveMinimum: 0
 *               notas:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cancelacion updated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/SolicitudCancelacion"
 *       400:
 *         description: Invalid request body.
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Solicitud or cancelacion not found.
 *   delete:
 *     summary: Soft delete a cancelacion from a first-party solicitud
 *     description: |
 *       Hace soft delete de la cancelacion. No elimina la fila fisicamente.
 *       Deja de aparecer en listados normales.
 *     tags:
 *       - Solicitudes Core Cancelaciones
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: cancelacionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Cancelacion soft deleted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/SolicitudCancelacion"
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Solicitud or cancelacion not found.
 */

export {};
