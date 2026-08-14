import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import type { GetCurrentUserUseCase } from "../../auth/application/use-cases/GetCurrentUser.use-case";
import { ForbiddenSystemAdminOnlyError } from "../../auth/domain/auth-errors";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import type { GetWorkflowTransitionsByStateUseCase } from "../application/use-cases/GetWorkflowTransitionsByState.use-case";
import type { ListWorkflowTransitionsUseCase } from "../application/use-cases/ListWorkflowTransitions.use-case";
import type { UpdateWorkflowTransitionMetadataUseCase } from "../application/use-cases/UpdateWorkflowTransitionMetadata.use-case";
import { InvalidSolicitudesCoreRequestError } from "../domain/solicitudes-core-errors";
import {
  type UpdateWorkflowTransitionBody,
  updateWorkflowTransitionBodySchema,
  type WorkflowTransitionIdParams,
  workflowTransitionIdParamsSchema,
  type WorkflowTransitionStateCodeParams,
  workflowTransitionStateCodeParamsSchema,
} from "./WorkflowTransitionAdminRequest.schema";

type CookieRequest = Request & {
  cookies?: Record<string, string | undefined>;
};

type Dependencies = {
  getCurrentUserUseCase: GetCurrentUserUseCase;
  getWorkflowTransitionsByStateUseCase: GetWorkflowTransitionsByStateUseCase;
  listWorkflowTransitionsUseCase: ListWorkflowTransitionsUseCase;
  updateWorkflowTransitionMetadataUseCase: UpdateWorkflowTransitionMetadataUseCase;
};

export class WorkflowTransitionAdminController {
  private readonly getCurrentUserUseCase: GetCurrentUserUseCase;
  private readonly getWorkflowTransitionsByStateUseCase: GetWorkflowTransitionsByStateUseCase;
  private readonly listWorkflowTransitionsUseCase: ListWorkflowTransitionsUseCase;
  private readonly updateWorkflowTransitionMetadataUseCase: UpdateWorkflowTransitionMetadataUseCase;

  constructor(dependencies: Dependencies) {
    this.getCurrentUserUseCase = dependencies.getCurrentUserUseCase;
    this.getWorkflowTransitionsByStateUseCase =
      dependencies.getWorkflowTransitionsByStateUseCase;
    this.listWorkflowTransitionsUseCase =
      dependencies.listWorkflowTransitionsUseCase;
    this.updateWorkflowTransitionMetadataUseCase =
      dependencies.updateWorkflowTransitionMetadataUseCase;
  }

  listRules = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const currentUser = await this.getSystemAdmin(req);
      const result = await this.listWorkflowTransitionsUseCase.execute({
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
      const params = this.parseRequest<WorkflowTransitionStateCodeParams>(
        workflowTransitionStateCodeParamsSchema,
        req.params,
      );
      const result = await this.getWorkflowTransitionsByStateUseCase.execute({
        currentUserId: currentUser.id,
        stateCode: params.stateCode,
      });

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
      const params = this.parseRequest<WorkflowTransitionIdParams>(
        workflowTransitionIdParamsSchema,
        req.params,
      );
      const body = this.parseRequest<UpdateWorkflowTransitionBody>(
        updateWorkflowTransitionBodySchema,
        req.body,
      );
      const result =
        await this.updateWorkflowTransitionMetadataUseCase.execute({
          actionLabel: body.actionLabel,
          currentUserId: currentUser.id,
          defaultComment: body.defaultComment,
          description: body.description,
          requiresComment: body.requiresComment,
          sortOrder: body.sortOrder,
          transitionId: params.transitionId,
          updatedAt: body.updatedAt,
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
