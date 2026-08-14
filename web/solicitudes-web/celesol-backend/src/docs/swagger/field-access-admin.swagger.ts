/**
 * @openapi
 * tags:
 *   - name: Field Access Admin
 *     description: Configuracion de reglas de edicion de campos por estado de workflow (solo administradores).
 *
 * components:
 *   schemas:
 *     FieldAccessRuleRecord:
 *       type: object
 *       nullable: true
 *       description: Regla persistida para el estado, o null si nunca se configuro (aplica el fallback readonly).
 *       properties:
 *         workflowStateId:
 *           type: string
 *           format: uuid
 *         active:
 *           type: boolean
 *         defaultMode:
 *           type: string
 *         editableFields:
 *           type: array
 *           items:
 *             type: string
 *         editableGroups:
 *           type: array
 *           items:
 *             type: string
 *         canManageAttachments:
 *           type: boolean
 *         backgroundColor:
 *           type: string
 *           nullable: true
 *         textColor:
 *           type: string
 *           nullable: true
 *         readonlyReason:
 *           type: string
 *           nullable: true
 *         version:
 *           type: integer
 *     FieldAccessRuleEntry:
 *       type: object
 *       properties:
 *         state:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *               format: uuid
 *             code:
 *               type: string
 *             name:
 *               type: string
 *         rule:
 *           $ref: '#/components/schemas/FieldAccessRuleRecord'
 *         resolvedFieldAccess:
 *           type: object
 *           description: Reglas efectivas ya resueltas (con el fallback readonly aplicado si corresponde).
 *         resolvedAppearance:
 *           type: object
 *           properties:
 *             backgroundColor:
 *               type: string
 *               nullable: true
 *             textColor:
 *               type: string
 *               nullable: true
 *         source:
 *           type: string
 *           enum: [persisted, fallback_missing, fallback_inactive, fallback_invalid]
 *     UpdateFieldAccessRuleRequest:
 *       type: object
 *       required:
 *         - active
 *         - canManageAttachments
 *         - editableFields
 *         - editableGroups
 *         - version
 *       properties:
 *         active:
 *           type: boolean
 *         editableFields:
 *           type: array
 *           items:
 *             type: string
 *         editableGroups:
 *           type: array
 *           items:
 *             type: string
 *         canManageAttachments:
 *           type: boolean
 *         backgroundColor:
 *           type: string
 *           nullable: true
 *         textColor:
 *           type: string
 *           nullable: true
 *         readonlyReason:
 *           type: string
 *           nullable: true
 *         version:
 *           type: integer
 *           description: Version leida al obtener la regla -- usada para optimistic locking.
 */

/**
 * @openapi
 * /admin/solicitudes/field-access-rules:
 *   get:
 *     summary: List field access rules for every workflow state
 *     description: Solo administradores.
 *     tags:
 *       - Field Access Admin
 *     security:
 *       - accessTokenCookie: []
 *     responses:
 *       200:
 *         description: Rules by state.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rules:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/FieldAccessRuleEntry'
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Current user is not a system admin.
 */

/**
 * @openapi
 * /admin/solicitudes/field-access-fields:
 *   get:
 *     summary: Get the field/group catalog available for rules
 *     description: Solo administradores. Usado para poblar el editor de reglas (que campos/grupos se pueden marcar editables).
 *     tags:
 *       - Field Access Admin
 *     security:
 *       - accessTokenCookie: []
 *     responses:
 *       200:
 *         description: Field catalog.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 allowedDefaultModes:
 *                   type: array
 *                   items:
 *                     type: string
 *                 blockedFields:
 *                   type: array
 *                   items:
 *                     type: string
 *                 defaultReadonlyReason:
 *                   type: string
 *                 fieldCatalog:
 *                   type: object
 *                   description: Campos disponibles agrupados por seccion (titular, conyuge, datosLaborales, garantias, solicitud).
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Current user is not a system admin.
 */

/**
 * @openapi
 * /admin/solicitudes/field-access-rules/{stateCode}:
 *   get:
 *     summary: Get the field access rule for a single workflow state
 *     description: Solo administradores.
 *     tags:
 *       - Field Access Admin
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: stateCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Rule for the state.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/FieldAccessRuleEntry'
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Current user is not a system admin.
 *       404:
 *         description: Workflow state not found.
 *   put:
 *     summary: Replace the field access rule for a workflow state
 *     description: |
 *       Solo administradores. Usa optimistic locking via `version` -- si no
 *       coincide con la version actual persistida, devuelve 409.
 *     tags:
 *       - Field Access Admin
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: stateCode
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateFieldAccessRuleRequest'
 *     responses:
 *       200:
 *         description: Updated rule.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/FieldAccessRuleEntry'
 *       400:
 *         description: |
 *           Invalid request body, unknown/blocked field or group, or
 *           duplicated field/group in the same rule.
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Current user is not a system admin.
 *       404:
 *         description: Workflow state not found.
 *       409:
 *         description: The rule was modified by someone else (version mismatch).
 */
export {};
