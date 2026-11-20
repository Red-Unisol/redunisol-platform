import { Router } from "express";

import type { AuthController } from "./AuthController";

export class UsersRoutes {
  static create(controller: AuthController) {
    const router = Router();

    /**
     * @openapi
     * /auth/users/{id}:
     *   patch:
     *     summary: Update a user's profile fields (admin)
     *     description: |
     *       Solo administradores. Patch parcial -- al menos un campo es
     *       obligatorio. Distinto de `PATCH /auth/me`, que solo permite al
     *       usuario editar su propio perfil.
     *     tags:
     *       - Auth
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
     *             properties:
     *               email:
     *                 type: string
     *                 format: email
     *               firstName:
     *                 type: string
     *               lastName:
     *                 type: string
     *               legacyUser:
     *                 type: string
     *               isSystemAdmin:
     *                 type: boolean
     *               state:
     *                 type: integer
     *                 enum: [0, 1]
     *                 description: 0 = inactivo, 1 = activo.
     *     responses:
     *       200:
     *         description: Updated user.
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 user:
     *                   $ref: '#/components/schemas/AuthUser'
     *       400:
     *         description: Invalid request body (or empty patch).
     *       401:
     *         description: Invalid session.
     *       403:
     *         description: |
     *           Current user is not a system admin, or the change would
     *           demote/deactivate the last active system admin.
     *       404:
     *         description: User not found.
     *       409:
     *         description: Email or legacy user already in use.
     */
    router.patch("/:id", controller.updateUser);

    /**
     * @openapi
     * /auth/users/{id}/workflow-owner:
     *   patch:
     *     summary: Assign (or clear) a user's workflow owner
     *     description: Solo administradores.
     *     tags:
     *       - Auth
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
     *               - workflowOwnerId
     *             properties:
     *               workflowOwnerId:
     *                 type: string
     *                 format: uuid
     *                 nullable: true
     *                 description: null desasigna el area actual del usuario.
     *     responses:
     *       200:
     *         description: Updated user.
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 user:
     *                   $ref: '#/components/schemas/AuthUser'
     *       400:
     *         description: Invalid request body.
     *       401:
     *         description: Invalid session.
     *       403:
     *         description: Current user is not a system admin.
     *       404:
     *         description: User or workflow owner not found.
     *       409:
     *         description: Área inactiva o cuenta con varias áreas. Usar workflow-owners para editarla.
     */
    router.patch("/:id/workflow-owner", controller.assignWorkflowOwner);
    /**
     * @openapi
     * /auth/users/{id}/workflow-owners:
     *   patch:
     *     summary: Reemplaza las áreas de un usuario
     *     description: Solo administradores. Se pueden combinar Análisis, Tesorería y Legajos Digitales.
     *     tags: [Auth]
     *     security:
     *       - accessTokenCookie: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string, format: uuid }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [workflowOwnerIds]
     *             properties:
     *               workflowOwnerIds:
     *                 type: array
     *                 uniqueItems: true
     *                 maxItems: 3
     *                 items: { type: string, format: uuid }
     *     responses:
     *       200:
     *         description: Usuario actualizado y solicitudes activas asignadas en las áreas retiradas.
     *       400:
     *         description: Áreas inválidas, inactivas o incompatibles.
     *       403:
     *         description: Requiere un administrador de sistemas.
     */
    router.patch("/:id/workflow-owners", controller.assignWorkflowOwners);

    return router;
  }
}
