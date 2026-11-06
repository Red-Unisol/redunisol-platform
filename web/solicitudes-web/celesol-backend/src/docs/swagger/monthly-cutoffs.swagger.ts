/**
 * @openapi
 * /api/monthly-cutoffs/amejuca/{period}:
 *   get:
 *     summary: Consultar el corte mensual confirmado de AMEJUCA y su estado
 *     tags: [Cortes mensuales]
 *     parameters:
 *       - in: path
 *         name: period
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-11"
 *     responses:
 *       200:
 *         description: Estado confirmed o estimated, record nullable y canManage. El historial se entrega a Riesgo y administradores.
 *       400:
 *         description: Período inválido.
 *       401:
 *         description: Sesión requerida.
 *   put:
 *     summary: Guardar el corte mensual como analista de Riesgo o administrador
 *     tags: [Cortes mensuales]
 *     parameters:
 *       - in: path
 *         name: period
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-11"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cutoffDate, expectedVersion]
 *             properties:
 *               cutoffDate:
 *                 type: string
 *                 format: date
 *               expectedVersion:
 *                 type: integer
 *                 minimum: 0
 *                 description: Cero para una primera carga; la versión recibida en GET para modificar.
 *               note:
 *                 type: string
 *                 maxLength: 1000
 *     responses:
 *       200:
 *         description: Corte guardado e historial actualizado.
 *       400:
 *         description: Fecha inválida o fuera del mes.
 *       401:
 *         description: Sesión requerida.
 *       403:
 *         description: Requiere Riesgo o administrador.
 *       409:
 *         description: Otro analista cambió el corte; recargar antes de guardar.
 */
export {};
