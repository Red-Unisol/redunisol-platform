/**
 * @openapi
 * tags:
 *   - name: Solicitudes Core Adjuntos
 *     description: Adjuntos privados asociados a solicitudes propias.
 */

/**
 * @openapi
 * /solicitudes/{id}/adjuntos:
 *   post:
 *     summary: Upload an adjunto for a first-party solicitud
 *     description: |
 *       Recibe `multipart/form-data` y sube el archivo a MinIO a traves del backend.
 *       El archivo debe enviarse en el campo `file`.
 *     tags:
 *       - Solicitudes Core Adjuntos
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               tipoAdjunto:
 *                 type: string
 *               descripcion:
 *                 type: string
 *               adicional:
 *                 type: string
 *               comentario:
 *                 type: string
 *               nroDocumento:
 *                 type: string
 *               restringido:
 *                 type: boolean
 *           encoding:
 *             file:
 *               contentType: application/pdf, image/jpeg, image/png
 *     responses:
 *       201:
 *         description: Adjunto created.
 *       400:
 *         description: Invalid multipart or metadata payload.
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Solicitud not found.
 *       409:
 *         description: Solicitud not editable in current state.
 *       415:
 *         description: Upload not allowed by extension, MIME type or size.
 *       503:
 *         description: Storage unavailable.
 *   get:
 *     summary: List non-deleted adjuntos for a first-party solicitud
 *     description: Lista solo adjuntos no eliminados logicamente.
 *     tags:
 *       - Solicitudes Core Adjuntos
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
 *         description: Adjunto list.
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Solicitud not found.
 */

/**
 * @openapi
 * /solicitudes/{id}/adjuntos/batch:
 *   post:
 *     summary: Upload multiple adjuntos for a first-party solicitud in one request
 *     description: |
 *       Recibe `multipart/form-data` con varios archivos en el campo `files`
 *       y un campo `metadata` con un array JSON (un objeto de metadata por
 *       archivo, en el mismo orden). La cantidad de archivos debe coincidir
 *       con la cantidad de elementos de `metadata`. Maximo 10 archivos por
 *       lote.
 *     tags:
 *       - Solicitudes Core Adjuntos
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - files
 *               - metadata
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *               metadata:
 *                 type: string
 *                 description: |
 *                   Array JSON serializado como string, un elemento por
 *                   archivo (mismo orden que `files`).
 *                 example: '[{"tipoAdjunto":"DNI"},{"tipoAdjunto":"Recibo de Sueldo"}]'
 *     responses:
 *       201:
 *         description: Adjuntos created.
 *       400:
 *         description: |
 *           Invalid payload, sin archivos, o la cantidad de archivos no
 *           coincide con la cantidad de metadatos.
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Solicitud not found.
 *       409:
 *         description: Solicitud not editable in current state.
 *       415:
 *         description: Upload not allowed by extension, MIME type or size.
 *       503:
 *         description: Storage unavailable.
 */

/**
 * @openapi
 * /solicitudes/{id}/adjuntos/{adjuntoId}/download:
 *   get:
 *     summary: Download an adjunto through the backend stream
 *     description: Descarga el adjunto por stream sin exponer una URL firmada de MinIO.
 *     tags:
 *       - Solicitudes Core Adjuntos
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
 *         name: adjuntoId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Binary adjunto stream.
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Solicitud or adjunto not found.
 *       409:
 *         description: Storage reference missing.
 *       503:
 *         description: Storage unavailable.
 */

/**
 * @openapi
 * /solicitudes/{id}/adjuntos/{adjuntoId}:
 *   patch:
 *     summary: Update an adjunto's metadata
 *     description: Patch parcial -- todos los campos son opcionales, no reemplaza el archivo.
 *     tags:
 *       - Solicitudes Core Adjuntos
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
 *         name: adjuntoId
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
 *               tipoAdjunto:
 *                 type: string
 *               descripcion:
 *                 type: string
 *               adicional:
 *                 type: string
 *               comentario:
 *                 type: string
 *               nroDocumento:
 *                 type: string
 *               restringido:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Adjunto updated.
 *       400:
 *         description: Invalid request body.
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Adjunto not found.
 *       409:
 *         description: Solicitud not editable in current state.
 *   delete:
 *     summary: Soft delete an adjunto from a first-party solicitud
 *     description: |
 *       Hace soft delete del adjunto. No elimina el objeto fisico del bucket.
 *       El adjunto deja de aparecer en listados normales.
 *     tags:
 *       - Solicitudes Core Adjuntos
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
 *         name: adjuntoId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               deleteReason:
 *                 type: string
 *               comentario:
 *                 type: string
 *     responses:
 *       200:
 *         description: Adjunto soft deleted.
 *       400:
 *         description: Invalid request body.
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Solicitud or adjunto not found.
 */

export {};
