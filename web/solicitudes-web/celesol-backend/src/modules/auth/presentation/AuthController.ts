import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";

import type { GetCurrentUserUseCase } from "../application/use-cases/GetCurrentUser.use-case";
import type { AssignWorkflowOwnerUseCase } from "../application/use-cases/AssignWorkflowOwner.use-case";
import type { LoginUserUseCase } from "../application/use-cases/LoginUser.use-case";
import type { ListPendingAreaUsersUseCase } from "../application/use-cases/ListPendingAreaUsers.use-case";
import type { ListUsersUseCase } from "../application/use-cases/ListUsers.use-case";
import type { ListWorkflowOwnersUseCase } from "../application/use-cases/ListWorkflowOwners.use-case";
import type { LogoutUserUseCase } from "../application/use-cases/LogoutUser.use-case";
import type { RegisterUserUseCase } from "../application/use-cases/RegisterUser.use-case";
import type { ResendVerificationCodeUseCase } from "../application/use-cases/ResendVerificationCode.use-case";
import type { RefreshSessionUseCase } from "../application/use-cases/RefreshSession.use-case";
import type { RequestPasswordResetUseCase } from "../application/use-cases/RequestPasswordReset.use-case";
import type { ResetPasswordUseCase } from "../application/use-cases/ResetPassword.use-case";
import type { VerifyEmailUseCase } from "../application/use-cases/VerifyEmail.use-case";
import type { UpdateUserUseCase } from "../application/use-cases/UpdateUser.use-case";
import type { UpdateOwnProfileUseCase } from "../application/use-cases/UpdateOwnProfile.use-case";
import type { ChangeOwnPasswordUseCase } from "../application/use-cases/ChangeOwnPassword.use-case";
import {
  ForbiddenSystemAdminOnlyError,
  InvalidRequestError,
} from "../domain/auth-errors";
import type { RequestMetadata } from "../domain/entities/RefreshToken.entity";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  type AuthCookieConfig,
  clearAuthCookies,
  setAuthCookies,
} from "./AuthCookies";
import {
  assignWorkflowOwnerBodySchema,
  assignWorkflowOwnerParamsSchema,
  type AssignWorkflowOwnerBody,
  type AssignWorkflowOwnerParams,
} from "./AssignWorkflowOwnerRequest.schema";
import {
  loginRequestSchema,
  type LoginRequestBody,
} from "./LoginRequest.schema";
import {
  registerRequestSchema,
  type RegisterRequestBody,
} from "./RegisterRequest.schema";
import {
  resendVerificationCodeRequestSchema,
  type ResendVerificationCodeRequestBody,
} from "./ResendVerificationCodeRequest.schema";
import {
  requestPasswordResetRequestSchema,
  type RequestPasswordResetRequestBody,
} from "./RequestPasswordResetRequest.schema";
import {
  resetPasswordRequestSchema,
  type ResetPasswordRequestBody,
} from "./ResetPasswordRequest.schema";
import {
  verifyEmailRequestSchema,
  type VerifyEmailRequestBody,
} from "./VerifyEmailRequest.schema";
import {
  updateUserBodySchema,
  updateUserParamsSchema,
  type UpdateUserBody,
  type UpdateUserParams,
} from "./UpdateUserRequest.schema";
import {
  updateOwnProfileRequestSchema,
  type UpdateOwnProfileRequestBody,
} from "./UpdateOwnProfileRequest.schema";
import {
  changeOwnPasswordRequestSchema,
  type ChangeOwnPasswordRequestBody,
} from "./ChangeOwnPasswordRequest.schema";

type CookieRequest = Request & {
  cookies?: Record<string, string | undefined>;
};

type AuthControllerDependencies = {
  assignWorkflowOwnerUseCase: AssignWorkflowOwnerUseCase;
  authCookieConfig: AuthCookieConfig;
  getCurrentUserUseCase: GetCurrentUserUseCase;
  listUsersUseCase: ListUsersUseCase;
  listPendingAreaUsersUseCase: ListPendingAreaUsersUseCase;
  listWorkflowOwnersUseCase: ListWorkflowOwnersUseCase;
  loginUserUseCase: LoginUserUseCase;
  logoutUserUseCase: LogoutUserUseCase;
  registerUserUseCase: RegisterUserUseCase;
  resendVerificationCodeUseCase: ResendVerificationCodeUseCase;
  refreshSessionUseCase: RefreshSessionUseCase;
  requestPasswordResetUseCase: RequestPasswordResetUseCase;
  resetPasswordUseCase: ResetPasswordUseCase;
  updateUserUseCase: UpdateUserUseCase;
  updateOwnProfileUseCase: UpdateOwnProfileUseCase;
  changeOwnPasswordUseCase: ChangeOwnPasswordUseCase;
  verifyEmailUseCase: VerifyEmailUseCase;
};

export class AuthController {
  private readonly assignWorkflowOwnerUseCase: AssignWorkflowOwnerUseCase;
  private readonly authCookieConfig: AuthCookieConfig;
  private readonly getCurrentUserUseCase: GetCurrentUserUseCase;
  private readonly listUsersUseCase: ListUsersUseCase;
  private readonly listPendingAreaUsersUseCase: ListPendingAreaUsersUseCase;
  private readonly listWorkflowOwnersUseCase: ListWorkflowOwnersUseCase;
  private readonly loginUserUseCase: LoginUserUseCase;
  private readonly logoutUserUseCase: LogoutUserUseCase;
  private readonly registerUserUseCase: RegisterUserUseCase;
  private readonly resendVerificationCodeUseCase: ResendVerificationCodeUseCase;
  private readonly refreshSessionUseCase: RefreshSessionUseCase;
  private readonly requestPasswordResetUseCase: RequestPasswordResetUseCase;
  private readonly resetPasswordUseCase: ResetPasswordUseCase;
  private readonly updateUserUseCase: UpdateUserUseCase;
  private readonly updateOwnProfileUseCase: UpdateOwnProfileUseCase;
  private readonly changeOwnPasswordUseCase: ChangeOwnPasswordUseCase;
  private readonly verifyEmailUseCase: VerifyEmailUseCase;

  constructor(dependencies: AuthControllerDependencies) {
    this.assignWorkflowOwnerUseCase = dependencies.assignWorkflowOwnerUseCase;
    this.authCookieConfig = dependencies.authCookieConfig;
    this.getCurrentUserUseCase = dependencies.getCurrentUserUseCase;
    this.listUsersUseCase = dependencies.listUsersUseCase;
    this.listPendingAreaUsersUseCase = dependencies.listPendingAreaUsersUseCase;
    this.listWorkflowOwnersUseCase = dependencies.listWorkflowOwnersUseCase;
    this.loginUserUseCase = dependencies.loginUserUseCase;
    this.logoutUserUseCase = dependencies.logoutUserUseCase;
    this.registerUserUseCase = dependencies.registerUserUseCase;
    this.resendVerificationCodeUseCase =
      dependencies.resendVerificationCodeUseCase;
    this.refreshSessionUseCase = dependencies.refreshSessionUseCase;
    this.requestPasswordResetUseCase =
      dependencies.requestPasswordResetUseCase;
    this.resetPasswordUseCase = dependencies.resetPasswordUseCase;
    this.updateUserUseCase = dependencies.updateUserUseCase;
    this.updateOwnProfileUseCase = dependencies.updateOwnProfileUseCase;
    this.changeOwnPasswordUseCase = dependencies.changeOwnPasswordUseCase;
    this.verifyEmailUseCase = dependencies.verifyEmailUseCase;
  }

  register = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = this.parseBody<RegisterRequestBody>(
        registerRequestSchema,
        req.body,
      );
      const result = await this.registerUserUseCase.execute({
        email: body.email,
        firstName: body.firstName,
        lastName: body.lastName,
        legacyUser: body.legacyUser,
        password: body.password,
      });

      if (!result.verificationEmailSent) {
        res.status(201).json({
          ...result,
          message:
            "User registered. Verification email could not be sent. Request a new code.",
        });
        return;
      }

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  verifyEmail = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = this.parseBody<VerifyEmailRequestBody>(
        verifyEmailRequestSchema,
        req.body,
      );
      const identifier = body.identifier ?? body.email;

      if (!identifier) {
        throw new InvalidRequestError("Request body invalido.");
      }

      const user = await this.verifyEmailUseCase.execute({
        code: body.code,
        identifier,
      });

      res.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  };

  resendVerificationCode = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const body = this.parseBody<ResendVerificationCodeRequestBody>(
        resendVerificationCodeRequestSchema,
        req.body,
      );
      const identifier = body.identifier ?? body.email;

      if (!identifier) {
        throw new InvalidRequestError("Request body invalido.");
      }

      await this.resendVerificationCodeUseCase.execute({
        identifier,
      });

      res.status(200).json({
        message: "If the account exists and is not verified, a new code was sent.",
      });
    } catch (error) {
      next(error);
    }
  };

  forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = this.parseBody<RequestPasswordResetRequestBody>(
        requestPasswordResetRequestSchema,
        req.body,
      );
      await this.requestPasswordResetUseCase.execute({
        email: body.email,
      });

      res.status(200).json({
        message:
          "If the account exists, a password reset email will be sent.",
      });
    } catch (error) {
      next(error);
    }
  };

  resetPassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = this.parseBody<ResetPasswordRequestBody>(
        resetPasswordRequestSchema,
        req.body,
      );
      await this.resetPasswordUseCase.execute({
        password: body.password,
        token: body.token,
      });

      res.status(200).json({
        message: "Password reset successfully.",
      });
    } catch (error) {
      next(error);
    }
  };

  login = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = this.parseBody<LoginRequestBody>(
        loginRequestSchema,
        req.body,
      );
      const session = await this.loginUserUseCase.execute({
        identifier: body.identifier,
        metadata: this.getRequestMetadata(req),
        password: body.password,
      });

      setAuthCookies(res, session.tokens, this.authCookieConfig);
      res.status(200).json({ user: session.user });
    } catch (error) {
      next(error);
    }
  };

  refresh = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const session = await this.refreshSessionUseCase.execute({
        metadata: this.getRequestMetadata(req),
        refreshToken: req.cookies?.[REFRESH_TOKEN_COOKIE],
      });

      setAuthCookies(res, session.tokens, this.authCookieConfig);
      res.status(200).json({ user: session.user });
    } catch (error) {
      next(error);
    }
  };

  logout = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      await this.logoutUserUseCase.execute(req.cookies?.[REFRESH_TOKEN_COOKIE]);
      clearAuthCookies(res, this.authCookieConfig);
      res.status(204).send();
    } catch (error) {
      clearAuthCookies(res, this.authCookieConfig);
      next(error);
    }
  };

  me = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const user = await this.getCurrentUserUseCase.execute(
        req.cookies?.[ACCESS_TOKEN_COOKIE],
      );

      res.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  };

  listPendingAreaUsers = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const currentUser = await this.getCurrentUserUseCase.execute(
        (req as CookieRequest).cookies?.[ACCESS_TOKEN_COOKIE],
      );
      if (!currentUser.isSystemAdmin) {
        throw new ForbiddenSystemAdminOnlyError();
      }

      const users = await this.listPendingAreaUsersUseCase.execute();
      res.status(200).json({
        users: users.map((user) => ({
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          legacyUser: user.legacyUser,
          state: user.state,
          workflowOwnerId: user.workflowOwnerId,
        })),
      });
    } catch (error) {
      next(error);
    }
  };

  listUsers = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUser = await this.getCurrentUserUseCase.execute(
        (req as CookieRequest).cookies?.[ACCESS_TOKEN_COOKIE],
      );
      if (!currentUser.isSystemAdmin) {
        throw new ForbiddenSystemAdminOnlyError();
      }

      const users = await this.listUsersUseCase.execute();
      res.status(200).json({ users });
    } catch (error) {
      next(error);
    }
  };

  listWorkflowOwners = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const currentUser = await this.getCurrentUserUseCase.execute(
        (req as CookieRequest).cookies?.[ACCESS_TOKEN_COOKIE],
      );
      if (!currentUser.isSystemAdmin) {
        throw new ForbiddenSystemAdminOnlyError();
      }

      const workflowOwners = await this.listWorkflowOwnersUseCase.execute();
      res.status(200).json({ workflowOwners });
    } catch (error) {
      next(error);
    }
  };

  assignWorkflowOwner = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const currentUser = await this.getCurrentUserUseCase.execute(
        (req as CookieRequest).cookies?.[ACCESS_TOKEN_COOKIE],
      );
      if (!currentUser.isSystemAdmin) {
        throw new ForbiddenSystemAdminOnlyError();
      }
      const params = this.parseBody<AssignWorkflowOwnerParams>(
        assignWorkflowOwnerParamsSchema,
        req.params,
      );
      const body = this.parseBody<AssignWorkflowOwnerBody>(
        assignWorkflowOwnerBodySchema,
        req.body,
      );

      const user = await this.assignWorkflowOwnerUseCase.execute({
        userId: params.id,
        workflowOwnerId: body.workflowOwnerId,
      });

      res.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  };

  updateUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUser = await this.getCurrentUserUseCase.execute(
        (req as CookieRequest).cookies?.[ACCESS_TOKEN_COOKIE],
      );
      if (!currentUser.isSystemAdmin) {
        throw new ForbiddenSystemAdminOnlyError();
      }
      const params = this.parseBody<UpdateUserParams>(
        updateUserParamsSchema,
        req.params,
      );
      const body = this.parseBody<UpdateUserBody>(updateUserBodySchema, req.body);

      const user = await this.updateUserUseCase.execute({
        authenticatedUserId: currentUser.id,
        email: body.email,
        firstName: body.firstName,
        isSystemAdmin: body.isSystemAdmin,
        lastName: body.lastName,
        legacyUser: body.legacyUser,
        state: body.state,
        userId: params.id,
      });

      res.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  };

  updateOwnProfile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUser = await this.getCurrentUserUseCase.execute(
        (req as CookieRequest).cookies?.[ACCESS_TOKEN_COOKIE],
      );
      const body = this.parseBody<UpdateOwnProfileRequestBody>(
        updateOwnProfileRequestSchema,
        req.body,
      );

      const user = await this.updateOwnProfileUseCase.execute({
        email: body.email,
        firstName: body.firstName,
        lastName: body.lastName,
        userId: currentUser.id,
      });

      res.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  };

  changeOwnPassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUser = await this.getCurrentUserUseCase.execute(
        (req as CookieRequest).cookies?.[ACCESS_TOKEN_COOKIE],
      );
      const body = this.parseBody<ChangeOwnPasswordRequestBody>(
        changeOwnPasswordRequestSchema,
        req.body,
      );

      await this.changeOwnPasswordUseCase.execute({
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        userId: currentUser.id,
      });

      clearAuthCookies(res, this.authCookieConfig);
      res.status(200).json({
        message: "Password updated. Please log in again.",
      });
    } catch (error) {
      next(error);
    }
  };

  private getRequestMetadata(req: Request): RequestMetadata {
    return {
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    };
  }

  private parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      throw new InvalidRequestError("Request body invalido.");
    }

    return parsed.data;
  }
}
