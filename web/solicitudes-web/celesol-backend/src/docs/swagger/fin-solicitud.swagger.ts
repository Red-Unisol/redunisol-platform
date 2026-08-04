/**
 * @openapi
 * tags:
 *   - name: Fin Solicitud
 *     description: |
 *       Endpoint publico consumido por el sistema de firma electronica
 *       (contrato `finSolicitud` de Redunisol/Caja). Sin autenticacion a
 *       proposito -- no depende de cookies de sesion.
 */

/**
 * @openapi
 * /api/redunisol/finSolicitud/{ntrans}/{sol}:
 *   post:
 *     summary: Get loan/signature data for the external signing flow
 *     description: |
 *       Endpoint publico (sin cookie de sesion) que replica el contrato
 *       esperado por el sistema externo de firma electronica. `sol` acepta
 *       tanto el uuid interno de la solicitud en PostgreSQL como el legacyOid
 *       que genera Vimax al otorgar el prestamo; `ntrans` no se usa para
 *       resolver el dato pero forma parte del contrato externo.
 *     tags:
 *       - Fin Solicitud
 *     parameters:
 *       - in: path
 *         name: ntrans
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: sol
 *         required: true
 *         description: Uuid interno de la solicitud, o el legacyOid de Vimax.
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Datos del prestamo y del titular.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 nombreSocio:
 *                   type: string
 *                 cuotas:
 *                   type: string
 *                 prestamoCFT:
 *                   type: string
 *                   nullable: true
 *                 prestamoTEM:
 *                   type: string
 *                   nullable: true
 *                 prestamoTNA:
 *                   type: string
 *                   nullable: true
 *                 prestamoTEA:
 *                   type: string
 *                   nullable: true
 *                 cuotaResultante:
 *                   type: string
 *                   nullable: true
 *                 montoAfinanciar:
 *                   type: string
 *                   nullable: true
 *                 NumeroPrestamo:
 *                   type: integer
 *                   nullable: true
 *                 CapitalOriginal:
 *                   type: string
 *                   nullable: true
 *                 MontoPrestamo:
 *                   type: string
 *                   nullable: true
 *                 PrimerVencimiento:
 *                   type: string
 *                   nullable: true
 *                 Vencimiento:
 *                   type: string
 *                   nullable: true
 *                 DNI:
 *                   type: integer
 *                   nullable: true
 *                 FechaNacimiento:
 *                   type: string
 *                   nullable: true
 *                 Nacionalidad:
 *                   type: string
 *                   nullable: true
 *                 TelefonoMovil:
 *                   type: string
 *                   nullable: true
 *                 TelefonoFijo:
 *                   type: string
 *                   nullable: true
 *                 Localidad:
 *                   type: string
 *                   nullable: true
 *                 CodigoPostal:
 *                   type: string
 *                   nullable: true
 *                 Calle:
 *                   type: string
 *                   nullable: true
 *                 NroPuerta:
 *                   type: string
 *                 PisoDpto:
 *                   type: string
 *                 FechaEmision:
 *                   type: string
 *                   nullable: true
 *       400:
 *         description: Invalid params, or the solicitud's prestamo has not been generated yet.
 *       404:
 *         description: Solicitud not found.
 */
export {};
