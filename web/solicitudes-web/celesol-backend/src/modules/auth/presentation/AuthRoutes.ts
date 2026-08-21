import { Router } from "express";

import type { AuthController } from "./AuthController";

/**
 * @openapi
 * tags:
 *   - name: Auth
 *     description: Authentication and session endpoints.
 *
 * components:
 *   securitySchemes:
 *     accessTokenCookie:
 *       type: apiKey
 *       in: cookie
 *       name: accessToken
 *     refreshTokenCookie:
 *       type: apiKey
 *       in: cookie
 *       name: refreshToken
 *   schemas:
 *     AuthUser:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         email:
 *           type: string
 *           format: email
 *         legacyUser:
 *           type: string
 *         firstName:
 *           type: string
 *           nullable: true
 *         lastName:
 *           type: string
 *           nullable: true
 *         emailVerified:
 *           type: boolean
 *         state:
 *           type: integer
 *         workflowOwnerId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         workflowOwner:
 *           type: object
 *           nullable: true
 *           properties:
 *             id:
 *               type: string
 *               format: uuid
 *             code:
 *               type: string
 *             name:
 *               type: string
 *     AuthResponse:
 *       type: object
 *       properties:
 *         user:
 *           $ref: '#/components/schemas/AuthUser'
 *     RegisterResponse:
 *       type: object
 *       properties:
 *         user:
 *           $ref: '#/components/schemas/AuthUser'
 *         verificationEmailSent:
 *           type: boolean
 *         message:
 *           type: string
 *           description: Present only when the verification email could not be sent.
 *     LoginRequest:
 *       type: object
 *       required:
 *         - identifier
 *         - password
 *       properties:
 *         identifier:
 *           type: string
 *           description: Email or legacy username.
 *         password:
 *           type: string
 *           format: password
 *     RegisterRequest:
 *       type: object
 *       required:
 *         - email
 *         - legacyUser
 *         - password
 *         - firstName
 *         - lastName
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *         legacyUser:
 *           type: string
 *         password:
 *           type: string
 *           format: password
 *           minLength: 8
 *           description: Must include uppercase, lowercase, number, and symbol.
 *         firstName:
 *           type: string
 *         lastName:
 *           type: string
 *     VerifyEmailRequest:
 *       type: object
 *       required:
 *         - email
 *         - code
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *         code:
 *           type: string
 *           minLength: 6
 *           maxLength: 6
 *     ResendVerificationCodeRequest:
 *       type: object
 *       required:
 *         - email
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *     RequestPasswordResetRequest:
 *       type: object
 *       required:
 *         - email
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *     ResetPasswordRequest:
 *       type: object
 *       required:
 *         - token
 *         - password
 *       properties:
 *         token:
 *           type: string
 *         password:
 *           type: string
 *           format: password
 *           minLength: 8
 *           description: Must include uppercase, lowercase, number, and symbol.
 */
export class AuthRoutes {
  static create(controller: AuthController) {
    const router = Router();

    /**
     * @openapi
     * /auth/register:
     *   post:
     *     summary: Register a new user
     *     tags:
     *       - Auth
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/RegisterRequest'
     *     responses:
     *       201:
     *         description: User registered. Email verification may need resend if delivery failed.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/RegisterResponse'
     *       400:
     *         description: Invalid request body.
     *       409:
     *         description: Email or legacy user already registered.
     */
    router.post("/register", controller.register);

    /**
     * @openapi
     * /auth/verify-email:
     *   post:
     *     summary: Verify a registered user email
     *     tags:
     *       - Auth
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/VerifyEmailRequest'
     *     responses:
     *       200:
     *         description: Email verified.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AuthResponse'
     *       400:
     *         description: Invalid verification code.
     */
    router.post("/verify-email", controller.verifyEmail);

    /**
     * @openapi
     * /auth/resend-verification-code:
     *   post:
     *     summary: Resend email verification code
     *     tags:
     *       - Auth
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ResendVerificationCodeRequest'
     *     responses:
     *       200:
     *         description: Generic resend response.
     *       400:
     *         description: Invalid request body.
     */
    router.post("/resend-verification-code", controller.resendVerificationCode);

    /**
     * @openapi
     * /auth/forgot-password:
     *   post:
     *     summary: Request a password reset email
     *     tags:
     *       - Auth
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/RequestPasswordResetRequest'
     *     responses:
     *       200:
     *         description: Generic password reset email response.
     *       400:
     *         description: Invalid request body.
     */
    router.post("/forgot-password", controller.forgotPassword);

    /**
     * @openapi
     * /auth/reset-password:
     *   post:
     *     summary: Reset password with an emailed token
     *     tags:
     *       - Auth
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ResetPasswordRequest'
     *     responses:
     *       200:
     *         description: Password reset.
     *       400:
     *         description: Invalid request body or token.
     */
    router.post("/reset-password", controller.resetPassword);

    /**
     * @openapi
     * /auth/login:
     *   post:
     *     summary: Start an authenticated session
     *     tags:
     *       - Auth
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/LoginRequest'
     *     responses:
     *       200:
     *         description: Session created.
     *         headers:
     *           Set-Cookie:
     *             description: HttpOnly accessToken and refreshToken cookies.
     *             schema:
     *               type: string
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AuthResponse'
     *       400:
     *         description: Invalid request body.
     *       401:
     *         description: Invalid credentials.
     */
    router.post("/login", controller.login);

    /**
     * @openapi
     * /auth/refresh:
     *   post:
     *     summary: Refresh the current authenticated session
     *     tags:
     *       - Auth
     *     security:
     *       - refreshTokenCookie: []
     *     responses:
     *       200:
     *         description: Session refreshed.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AuthResponse'
     *       401:
     *         description: Invalid session.
     */
    router.post("/refresh", controller.refresh);

    /**
     * @openapi
     * /auth/logout:
     *   post:
     *     summary: End the current authenticated session
     *     tags:
     *       - Auth
     *     security:
     *       - refreshTokenCookie: []
     *     responses:
     *       204:
     *         description: Session ended.
     */
    router.post("/logout", controller.logout);

    /**
     * @openapi
     * /auth/users:
     *   get:
     *     summary: List all non-deleted users
     *     description: Solo administradores.
     *     tags:
     *       - Auth
     *     security:
     *       - accessTokenCookie: []
     *     responses:
     *       200:
     *         description: All non-deleted users.
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 users:
     *                   type: array
     *                   items:
     *                     $ref: '#/components/schemas/AuthUser'
     *       401:
     *         description: Invalid session.
     *       403:
     *         description: Current user is not a system admin.
     */
    router.get("/users", controller.listUsers);

    /**
     * @openapi
     * /auth/users/pending-area:
     *   get:
     *     summary: List active users without a workflow owner assigned
     *     description: Solo administradores.
     *     tags:
     *       - Auth
     *     security:
     *       - accessTokenCookie: []
     *     responses:
     *       200:
     *         description: Users pending area assignment.
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 users:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       id:
     *                         type: string
     *                         format: uuid
     *                       email:
     *                         type: string
     *                         format: email
     *                       firstName:
     *                         type: string
     *                         nullable: true
     *                       lastName:
     *                         type: string
     *                         nullable: true
     *                       legacyUser:
     *                         type: string
     *                       state:
     *                         type: integer
     *                       workflowOwnerId:
     *                         type: string
     *                         format: uuid
     *                         nullable: true
     *       401:
     *         description: Invalid session.
     *       403:
     *         description: Current user is not a system admin.
     */
    router.get("/users/pending-area", controller.listPendingAreaUsers);

    /**
     * @openapi
     * /auth/workflow-owners:
     *   get:
     *     summary: List active workflow owners
     *     description: Solo administradores. Usado para poblar el selector de asignacion de area.
     *     tags:
     *       - Auth
     *     security:
     *       - accessTokenCookie: []
     *     responses:
     *       200:
     *         description: Active workflow owners.
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 workflowOwners:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       id:
     *                         type: string
     *                         format: uuid
     *                       code:
     *                         type: string
     *                       name:
     *                         type: string
     *       401:
     *         description: Invalid session.
     *       403:
     *         description: Current user is not a system admin.
     */
    router.get("/workflow-owners", controller.listWorkflowOwners);

    /**
     * @openapi
     * /auth/me:
     *   get:
     *     summary: Get the current authenticated user
     *     tags:
     *       - Auth
     *     security:
     *       - accessTokenCookie: []
     *     responses:
     *       200:
     *         description: Current authenticated user.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AuthResponse'
     *       401:
     *         description: Invalid session.
     */
    router.get("/me", controller.me);

    /**
     * @openapi
     * /auth/me:
     *   patch:
     *     summary: Update the current authenticated user's profile
     *     tags:
     *       - Auth
     *     security:
     *       - accessTokenCookie: []
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
     *     responses:
     *       200:
     *         description: Profile updated.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AuthResponse'
     *       400:
     *         description: Invalid request body.
     *       401:
     *         description: Invalid session.
     *       409:
     *         description: Email already registered.
     */
    router.patch("/me", controller.updateOwnProfile);

    /**
     * @openapi
     * /auth/me/change-password:
     *   post:
     *     summary: Change the current authenticated user's password
     *     tags:
     *       - Auth
     *     security:
     *       - accessTokenCookie: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - currentPassword
     *               - newPassword
     *             properties:
     *               currentPassword:
     *                 type: string
     *                 format: password
     *               newPassword:
     *                 type: string
     *                 format: password
     *                 minLength: 8
     *     responses:
     *       200:
     *         description: Password updated. All sessions revoked.
     *       400:
     *         description: Invalid request body.
     *       401:
     *         description: Invalid session or incorrect current password.
     */
    router.post("/me/change-password", controller.changeOwnPassword);

    return router;
  }
}
