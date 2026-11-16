/**
 * @openapi
 * /solicitudes/{id}/datos-rapidos/cbu:
 *   get:
 *     summary: Consultar el CBU habitual del titular en Vimarx
 *     description: |
 *       Requiere acceso a la solicitud. Busca por documento y tipo guardados;
 *       no acepta identidades arbitrarias ni modifica cuentas o la solicitud.
 *       Sólo confirma un CBU cuando hay un único socio. Responde con Cache-Control no-store.
 *       Un fallo del proveedor se informa como unavailable, nunca como ausencia de cuenta.
 *     tags: [Solicitudes Core]
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
 *         description: Resultado de lectura; available no certifica la titularidad ni el formato bancario.
 *         headers:
 *           Cache-Control:
 *             schema:
 *               type: string
 *               example: no-store
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [status, cbu]
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [available, missing, not_member, ambiguous, unavailable]
 *                 cbu:
 *                   type: string
 *                   nullable: true
 *                   description: Valor registrado en Vimarx; null salvo cuando status es available.
 *       401:
 *         description: Sesión requerida.
 *       403:
 *         description: Sin acceso a la solicitud.
 *       404:
 *         description: Solicitud inexistente.
 */
export {};
