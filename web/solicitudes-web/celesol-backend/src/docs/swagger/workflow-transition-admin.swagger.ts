/**
 * @openapi
 * tags:
 *   - name: Workflow Transition Admin
 *     description: Configuracion de metadata de transiciones de workflow (solo administradores).
 *
 * components:
 *   schemas:
 *     WorkflowTransitionRecord:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         actionCode:
 *           type: string
 *         actionLabel:
 *           type: string
 *         description:
 *           type: string
 *           nullable: true
 *         defaultComment:
 *           type: string
 *           nullable: true
 *         requiresComment:
 *           type: boolean
 *         sortOrder:
 *           type: integer
 *         fromStateId:
 *           type: string
 *           format: uuid
 *         toStateId:
 *           type: string
 *           format: uuid
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     UpdateWorkflowTransitionRequest:
 *       type: object
 *       required:
 *         - actionLabel
 *         - description
 *         - sortOrder
 *         - defaultComment
 *         - requiresComment
 *         - updatedAt
 *       properties:
 *         actionLabel:
 *           type: string
 *         description:
 *           type: string
 *           nullable: true
 *         sortOrder:
 *           type: integer
 *         defaultComment:
 *           type: string
 *           nullable: true
 *         requiresComment:
 *           type: boolean
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Timestamp leido al obtener la transicion -- usado para optimistic locking.
 */

/**
 * @openapi
 * /admin/solicitudes/workflow-transitions:
 *   get:
 *     summary: List all workflow transitions grouped by state
 *     description: Solo administradores.
 *     tags:
 *       - Workflow Transition Admin
 *     security:
 *       - accessTokenCookie: []
 *     responses:
 *       200:
 *         description: Transitions by state.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transitions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/WorkflowTransitionRecord'
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Current user is not a system admin.
 */

/**
 * @openapi
 * /admin/solicitudes/workflow-transitions/{stateCode}:
 *   get:
 *     summary: List workflow transitions available from a single state
 *     description: Solo administradores.
 *     tags:
 *       - Workflow Transition Admin
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
 *         description: Transitions from the state.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transitions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/WorkflowTransitionRecord'
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Current user is not a system admin.
 *       404:
 *         description: Workflow state not found.
 */

/**
 * @openapi
 * /admin/solicitudes/workflow-transitions/{transitionId}:
 *   put:
 *     summary: Update a workflow transition's display metadata
 *     description: |
 *       Solo administradores. Solo actualiza metadata de presentacion
 *       (label, descripcion, orden, comentario por defecto) -- no cambia el
 *       estado origen/destino de la transicion. Usa optimistic locking via
 *       `updatedAt` -- si no coincide con el valor actual persistido,
 *       devuelve 409.
 *     tags:
 *       - Workflow Transition Admin
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: transitionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateWorkflowTransitionRequest'
 *     responses:
 *       200:
 *         description: Updated transition.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WorkflowTransitionRecord'
 *       400:
 *         description: Invalid request body.
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: Current user is not a system admin.
 *       404:
 *         description: Workflow transition not found.
 *       409:
 *         description: The transition was modified by someone else (updatedAt mismatch).
 */
export {};
