import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import type { GetCurrentUserUseCase } from "../../auth/application/use-cases/GetCurrentUser.use-case";
import { ForbiddenSystemAdminOnlyError } from "../../auth/domain/auth-errors";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import type { GetFieldAccessFieldCatalogUseCase } from "../application/use-cases/GetFieldAccessFieldCatalog.use-case";
import type { GetFieldAccessRuleByStateUseCase } from "../application/use-cases/GetFieldAccessRuleByState.use-case";
import type { ListFieldAccessRulesUseCase } from "../application/use-cases/ListFieldAccessRules.use-case";
import type { UpdateFieldAccessRuleUseCase } from "../application/use-cases/UpdateFieldAccessRule.use-case";
import { InvalidSolicitudesCoreRequestError } from "../domain/solicitudes-core-errors";
import {
  fieldAccessRuleStateCodeParamsSchema,
  type FieldAccessRuleStateCodeParams,
  type UpdateFieldAccessRuleBody,
  updateFieldAccessRuleBodySchema,
} from "./FieldAccessAdminRequest.schema";

type CookieRequest = Request & {
  cookies?: Record<string, string | undefined>;
};

type Dependencies = {
  getCurrentUserUseCase: GetCurrentUserUseCase;
  getFieldAccessFieldCatalogUseCase: GetFieldAccessFieldCatalogUseCase;
  getFieldAccessRuleByStateUseCase: GetFieldAccessRuleByStateUseCase;
  listFieldAccessRulesUseCase: ListFieldAccessRulesUseCase;
  updateFieldAccessRuleUseCase: UpdateFieldAccessRuleUseCase;
};

export class FieldAccessAdminController {
  private readonly getCurrentUserUseCase: GetCurrentUserUseCase;
  private readonly getFieldAccessFieldCatalogUseCase: GetFieldAccessFieldCatalogUseCase;
  private readonly getFieldAccessRuleByStateUseCase: GetFieldAccessRuleByStateUseCase;
  private readonly listFieldAccessRulesUseCase: ListFieldAccessRulesUseCase;
  private readonly updateFieldAccessRuleUseCase: UpdateFieldAccessRuleUseCase;

  constructor(dependencies: Dependencies) {
    this.getCurrentUserUseCase = dependencies.getCurrentUserUseCase;
    this.getFieldAccessFieldCatalogUseCase =
      dependencies.getFieldAccessFieldCatalogUseCase;
    this.getFieldAccessRuleByStateUseCase =
      dependencies.getFieldAccessRuleByStateUseCase;
    this.listFieldAccessRulesUseCase = dependencies.listFieldAccessRulesUseCase;
    this.updateFieldAccessRuleUseCase = dependencies.updateFieldAccessRuleUseCase;
  }

  listRules = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const currentUser = await this.getSystemAdmin(req);
      const result = await this.listFieldAccessRulesUseCase.execute({
        currentUserId: currentUser.id,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getRuleByState = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const currentUser = await this.getSystemAdmin(req);
      const params = this.parseRequest<FieldAccessRuleStateCodeParams>(
        fieldAccessRuleStateCodeParamsSchema,
        req.params,
      );
      const result = await this.getFieldAccessRuleByStateUseCase.execute({
        currentUserId: currentUser.id,
        stateCode: params.stateCode,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getFieldCatalog = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await this.getSystemAdmin(req);
      const result = await this.getFieldAccessFieldCatalogUseCase.execute();

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  updateRule = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const currentUser = await this.getSystemAdmin(req);
      const params = this.parseRequest<FieldAccessRuleStateCodeParams>(
        fieldAccessRuleStateCodeParamsSchema,
        req.params,
      );
      const body = this.parseRequest<UpdateFieldAccessRuleBody>(
        updateFieldAccessRuleBodySchema,
        req.body,
      );
      const result = await this.updateFieldAccessRuleUseCase.execute({
        active: body.active,
        backgroundColor: body.backgroundColor,
        canManageAttachments: body.canManageAttachments,
        currentUserId: currentUser.id,
        editableFields: body.editableFields,
        editableGroups: body.editableGroups,
        readonlyReason: body.readonlyReason,
        stateCode: params.stateCode,
        textColor: body.textColor,
        version: body.version,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  private async getSystemAdmin(req: CookieRequest) {
    const currentUser = await this.getCurrentUserUseCase.execute(
      req.cookies?.[ACCESS_TOKEN_COOKIE],
    );

    if (!currentUser.isSystemAdmin) {
      throw new ForbiddenSystemAdminOnlyError();
    }

    return currentUser;
  }

  private parseRequest<T>(schema: ZodSchema<T>, payload: unknown): T {
    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      throw new InvalidSolicitudesCoreRequestError();
    }

    return parsed.data;
  }
}
