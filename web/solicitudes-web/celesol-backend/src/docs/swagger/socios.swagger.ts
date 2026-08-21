/**
 * @openapi
 * tags:
 *   - name: Socios
 *     description: CRUD de socios (personas fisicas y juridicas) y sincronizacion con el maestro legado de Vimax.
 *
 * components:
 *   schemas:
 *     PersonaFisicaResponse:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         tipoPersona:
 *           type: string
 *           enum: [FISICA]
 *         cuit:
 *           type: string
 *         email:
 *           type: string
 *           nullable: true
 *         celular:
 *           type: string
 *           nullable: true
 *         nroSocioLegacy:
 *           type: string
 *           nullable: true
 *         apellido:
 *           type: string
 *         nombre:
 *           type: string
 *         nroDocumento:
 *           type: string
 *         tipoDocumento:
 *           type: string
 *         sexo:
 *           type: string
 *         fechaDeNacimiento:
 *           type: string
 *           format: date
 *         domicilioCalle:
 *           type: string
 *           nullable: true
 *         domicilioNroPuerta:
 *           type: string
 *           nullable: true
 *         domicilioLocalidad:
 *           type: string
 *           nullable: true
 *         domicilioCodigoPostal:
 *           type: string
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     PersonaJuridicaResponse:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         tipoPersona:
 *           type: string
 *           enum: [JURIDICA]
 *         cuit:
 *           type: string
 *         email:
 *           type: string
 *           nullable: true
 *         celular:
 *           type: string
 *           nullable: true
 *         nroSocioLegacy:
 *           type: string
 *           nullable: true
 *         razonSocial:
 *           type: string
 *         domicilioCalle:
 *           type: string
 *           nullable: true
 *         domicilioNroPuerta:
 *           type: string
 *           nullable: true
 *         domicilioLocalidad:
 *           type: string
 *           nullable: true
 *         domicilioCodigoPostal:
 *           type: string
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     SocioResponse:
 *       oneOf:
 *         - $ref: '#/components/schemas/PersonaFisicaResponse'
 *         - $ref: '#/components/schemas/PersonaJuridicaResponse'
 *     CreateSocioRequest:
 *       oneOf:
 *         - type: object
 *           required:
 *             - tipoPersona
 *             - cuit
 *             - nombre
 *             - apellido
 *             - nroDocumento
 *             - tipoDocumento
 *             - sexo
 *             - fechaDeNacimiento
 *             - domicilioCalle
 *             - domicilioNroPuerta
 *             - domicilioLocalidad
 *             - domicilioCodigoPostal
 *           properties:
 *             tipoPersona:
 *               type: string
 *               enum: [FISICA]
 *             cuit:
 *               type: string
 *             nombre:
 *               type: string
 *             apellido:
 *               type: string
 *             nroDocumento:
 *               type: string
 *             tipoDocumento:
 *               type: string
 *             sexo:
 *               type: string
 *             fechaDeNacimiento:
 *               type: string
 *               format: date
 *               description: Formato YYYY-MM-DD.
 *             celular:
 *               type: string
 *             email:
 *               type: string
 *               format: email
 *             domicilioCalle:
 *               type: string
 *             domicilioNroPuerta:
 *               type: string
 *             domicilioLocalidad:
 *               type: string
 *             domicilioCodigoPostal:
 *               type: string
 *         - type: object
 *           required:
 *             - tipoPersona
 *             - cuit
 *             - razonSocial
 *             - domicilioCalle
 *             - domicilioNroPuerta
 *             - domicilioLocalidad
 *             - domicilioCodigoPostal
 *           properties:
 *             tipoPersona:
 *               type: string
 *               enum: [JURIDICA]
 *             cuit:
 *               type: string
 *             razonSocial:
 *               type: string
 *             celular:
 *               type: string
 *             email:
 *               type: string
 *               format: email
 *             domicilioCalle:
 *               type: string
 *             domicilioNroPuerta:
 *               type: string
 *             domicilioLocalidad:
 *               type: string
 *             domicilioCodigoPostal:
 *               type: string
 *     UpdateSocioRequest:
 *       type: object
 *       description: |
 *         Patch parcial. Al menos un campo es obligatorio. Los campos
 *         especificos de persona fisica y juridica coexisten (aplican los
 *         que correspondan al tipoPersona actual del socio).
 *       properties:
 *         cuit:
 *           type: string
 *         apellido:
 *           type: string
 *         nombre:
 *           type: string
 *         nroDocumento:
 *           type: string
 *         tipoDocumento:
 *           type: string
 *         sexo:
 *           type: string
 *         fechaDeNacimiento:
 *           type: string
 *           format: date
 *         razonSocial:
 *           type: string
 *         celular:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         domicilioCalle:
 *           type: string
 *         domicilioNroPuerta:
 *           type: string
 *         domicilioLocalidad:
 *           type: string
 *         domicilioCodigoPostal:
 *           type: string
 *     ListSociosResponse:
 *       type: object
 *       properties:
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SocioResponse'
 *         total:
 *           type: integer
 *           description: Cantidad total de socios que matchean el filtro (no solo los de la pagina actual).
 *     LookupSocioResponse:
 *       type: object
 *       properties:
 *         match:
 *           type: string
 *           enum: [none, multiple, single]
 *         socio:
 *           allOf:
 *             - $ref: '#/components/schemas/SocioResponse'
 *           description: Presente solo cuando match es "single".
 *     CheckDuplicateResponse:
 *       type: object
 *       properties:
 *         exists:
 *           type: boolean
 *     SyncSociosFromLegacyResponse:
 *       type: object
 *       properties:
 *         fetched:
 *           type: integer
 *           description: Filas traidas desde Vimax en total.
 *         inserted:
 *           type: integer
 *           description: Filas validas que pasaron la clasificacion/dedupe (antes del upsert).
 *         upserted:
 *           type: integer
 *           description: Filas efectivamente insertadas o actualizadas en la base local.
 *         skippedMissingCuit:
 *           type: integer
 *         skippedIncompleteFisica:
 *           type: integer
 *         skippedDuplicateCuit:
 *           type: integer
 *         skippedDuplicateNroDocumento:
 *           type: integer
 */

/**
 * @openapi
 * /api/socios:
 *   post:
 *     summary: Create a socio
 *     description: Solo analistas y administradores pueden crear socios.
 *     tags:
 *       - Socios
 *     security:
 *       - accessTokenCookie: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateSocioRequest'
 *     responses:
 *       201:
 *         description: Socio created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SocioResponse'
 *       400:
 *         description: Invalid request body.
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Current user is not analista or admin.
 *       409:
 *         description: CUIT or documento already exists.
 *   get:
 *     summary: List socios
 *     description: Listado paginado con busqueda opcional por nombre/apellido/razon social/documento/CUIT.
 *     tags:
 *       - Socios
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated socios.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ListSociosResponse'
 *       401:
 *         description: Invalid session.
 */

/**
 * @openapi
 * /api/socios/sync-legacy:
 *   post:
 *     summary: Sync all socios from the Vimax legacy master
 *     description: |
 *       Corre de forma sincronica dentro del mismo request/response (puede
 *       tardar 1-2 minutos): trae todos los socios (persona fisica y
 *       juridica) desde el maestro legado de Vimax (`F.Module.SocioMutual`),
 *       los clasifica y deduplica, y hace upsert por CUIT en la base local.
 *       Nunca modifica los campos de domicilio (se cargan a mano) ni crea
 *       archivos intermedios.
 *     tags:
 *       - Socios
 *     security:
 *       - accessTokenCookie: []
 *     responses:
 *       200:
 *         description: Sync summary.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SyncSociosFromLegacyResponse'
 *       401:
 *         description: Invalid session.
 *       503:
 *         description: No se pudo conectar con el sistema legado.
 */

/**
 * @openapi
 * /api/socios/lookup:
 *   get:
 *     summary: Lookup a socio by documento or CUIT
 *     description: |
 *       Busca un socio existente por numero de documento (persona fisica) o
 *       CUIT (persona juridica). Usado para prellenar datos al crear una
 *       solicitud.
 *     tags:
 *       - Socios
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: query
 *         name: documento
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: tipoDocumento
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lookup result.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LookupSocioResponse'
 *       400:
 *         description: Invalid query params.
 *       401:
 *         description: Invalid session.
 */

/**
 * @openapi
 * /api/socios/check-cuit:
 *   get:
 *     summary: Check if a CUIT is already in use
 *     tags:
 *       - Socios
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: query
 *         name: cuit
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: excludeSocioId
 *         description: Socio id to exclude from the check (used when editing an existing socio).
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Duplicate check result.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CheckDuplicateResponse'
 *       400:
 *         description: Invalid query params.
 *       401:
 *         description: Invalid session.
 */

/**
 * @openapi
 * /api/socios/check-documento:
 *   get:
 *     summary: Check if a documento is already in use
 *     tags:
 *       - Socios
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: query
 *         name: nroDocumento
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: excludeSocioId
 *         description: Socio id to exclude from the check (used when editing an existing socio).
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Duplicate check result.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CheckDuplicateResponse'
 *       400:
 *         description: Invalid query params.
 *       401:
 *         description: Invalid session.
 */

/**
 * @openapi
 * /api/socios/{id}:
 *   get:
 *     summary: Get a socio by id
 *     tags:
 *       - Socios
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
 *         description: Socio detail.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SocioResponse'
 *       401:
 *         description: Invalid session.
 *       404:
 *         description: Socio not found.
 *   patch:
 *     summary: Update a socio
 *     description: Solo analistas y administradores pueden editar socios. Los campos de domicilio no se sincronizan desde Vimax.
 *     tags:
 *       - Socios
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
 *             $ref: '#/components/schemas/UpdateSocioRequest'
 *     responses:
 *       200:
 *         description: Socio updated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SocioResponse'
 *       400:
 *         description: Invalid request body (or empty patch).
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Current user is not analista or admin.
 *       404:
 *         description: Socio not found.
 *       409:
 *         description: CUIT or documento already exists.
 *   delete:
 *     summary: Delete a socio
 *     description: Solo analistas y administradores pueden eliminar socios.
 *     tags:
 *       - Socios
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
 *       204:
 *         description: Socio deleted.
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Current user is not analista or admin.
 *       404:
 *         description: Socio not found.
 */
export {};
