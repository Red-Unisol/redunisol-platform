/**
 * @openapi
 * tags:
 *   - name: Riesgo
 *     description: Calculadora de riesgo (analistas de RIESGO y administradores).
 *
 * components:
 *   schemas:
 *     CalculadoraMutualDatos:
 *       type: object
 *       properties:
 *         antiguedadLaboral:
 *           type: number
 *           nullable: true
 *         compromisoMensualVigente:
 *           type: number
 *           nullable: true
 *         convenio:
 *           type: string
 *           nullable: true
 *         cuitTitular:
 *           type: string
 *           nullable: true
 *         cuotaResultante:
 *           type: number
 *           nullable: true
 *         cuotas:
 *           type: number
 *           nullable: true
 *         cupoDisponibleVendedor:
 *           type: number
 *           nullable: true
 *         dniTitular:
 *           type: string
 *           nullable: true
 *         fechaPrimerVencimiento:
 *           type: string
 *           nullable: true
 *         fechaSolicitud:
 *           type: string
 *           nullable: true
 *         ingresos:
 *           type: number
 *           nullable: true
 *         lineaDescripcion:
 *           type: string
 *           nullable: true
 *         lineaId:
 *           type: integer
 *           nullable: true
 *         montoAFinanciar:
 *           type: number
 *           nullable: true
 *         nombreCompletoTitular:
 *           type: string
 *           nullable: true
 *         nroSolicitud:
 *           type: string
 *           nullable: true
 *         rechazosDelMes:
 *           type: integer
 *           nullable: true
 *         saldoPrestamosVigentes:
 *           type: number
 *           nullable: true
 *         situacionSocio:
 *           type: string
 *           nullable: true
 *         titularNuevo:
 *           type: boolean
 *           nullable: true
 *         vendedor:
 *           type: string
 *           nullable: true
 */

/**
 * @openapi
 * /api/riesgo/calculadora:
 *   get:
 *     summary: Download the calculadora de riesgo spreadsheet
 *     description: Solo analistas de RIESGO y administradores. Devuelve la version vigente de la base o, si no hay ninguna, el archivo .xlsx del repo.
 *     tags:
 *       - Riesgo
 *     security:
 *       - accessTokenCookie: []
 *     responses:
 *       200:
 *         description: Calculadora spreadsheet.
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Current user is not RIESGO or admin.
 *       404:
 *         description: Calculadora file not found on disk.
 */

/**
 * @openapi
 * /api/riesgo/calculadora/{oid}/datos:
 *   get:
 *     summary: Get calculadora data for a legacy solicitud (by OID)
 *     tags:
 *       - Riesgo
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: oid
 *         required: true
 *         description: Legacy solicitud OID (numeric).
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Calculadora data.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CalculadoraMutualDatos'
 *       400:
 *         description: Invalid solicitud OID.
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Current user is not RIESGO or admin.
 *       502:
 *         description: No se pudo conectar con el sistema legado.
 */

/**
 * @openapi
 * /api/riesgo/calculadora/core/{solicitudId}/datos:
 *   get:
 *     summary: Get calculadora data for a first-party solicitud (by core id)
 *     tags:
 *       - Riesgo
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: solicitudId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Calculadora data.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CalculadoraMutualDatos'
 *       400:
 *         description: Invalid solicitud id.
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Current user is not RIESGO or admin.
 *       404:
 *         description: Solicitud not found.
 *       502:
 *         description: No se pudo conectar con el sistema legado.
 */
export {};

/**
 * @openapi
 * /api/riesgo/calculadora/versiones:
 *   get:
 *     summary: List calculadora versions (vigente + 3 anteriores)
 *     description: Solo RIESGO y admin. De la mas nueva a la mas vieja, con quien la trajo y cuando.
 *     tags:
 *       - Riesgo
 *     security:
 *       - accessTokenCookie: []
 *     responses:
 *       200:
 *         description: "{ versiones: [...] }"
 *       403:
 *         description: Current user is not RIESGO or admin.
 *   post:
 *     summary: Apply the latest SCORINGPF from Vimarx
 *     description: Solo RIESGO y admin. Vuelve a bajar la planilla y la deja vigente si su huella es la de la vista previa. Devuelve version null si no cambio nada.
 *     tags:
 *       - Riesgo
 *     security:
 *       - accessTokenCookie: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [huellaVimarx]
 *             properties:
 *               huellaVimarx:
 *                 type: string
 *                 description: sha256 devuelto por la vista previa.
 *     responses:
 *       200:
 *         description: "{ version }"
 *       409:
 *         description: La planilla cambio en Vimarx desde la vista previa.
 *       422:
 *         description: La planilla no se puede adaptar sola.
 *       502:
 *         description: Vimarx no responde.
 */

/**
 * @openapi
 * /api/riesgo/calculadora/versiones/vista-previa:
 *   post:
 *     summary: Preview the changes of the latest SCORINGPF from Vimarx
 *     description: Solo RIESGO y admin. Baja y adapta la planilla y la compara con la vigente. No guarda nada.
 *     tags:
 *       - Riesgo
 *     security:
 *       - accessTokenCookie: []
 *     responses:
 *       200:
 *         description: "{ sinCambios, huellaVimarx, cambios: { hojas, hojasNuevas, hojasQuitadas } }"
 *       422:
 *         description: La planilla no se puede adaptar sola.
 *       502:
 *         description: Vimarx no responde.
 */

/**
 * @openapi
 * /api/riesgo/calculadora/versiones/{versionId}/restaurar:
 *   post:
 *     summary: Go back to a previous calculadora version
 *     description: Solo RIESGO y admin. Crea una copia vigente de esa version (origen RESTAURADA).
 *     tags:
 *       - Riesgo
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: versionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: "{ version }"
 *       404:
 *         description: La version ya no existe.
 *       409:
 *         description: La version ya es la vigente.
 */
