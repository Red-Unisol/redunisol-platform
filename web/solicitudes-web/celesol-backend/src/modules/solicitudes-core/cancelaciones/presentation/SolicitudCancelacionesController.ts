import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";

import type { GetCurrentUserUseCase } from "../../../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../../../auth/presentation/AuthCookies";
import type { CreateSolicitudCancelacionUseCase } from "../application/use-cases/CreateSolicitudCancelacion.use-case";
import type { DeleteSolicitudCancelacionUseCase } from "../application/use-cases/DeleteSolicitudCancelacion.use-case";
import type { ListSolicitudCancelacionesUseCase } from "../application/use-cases/ListSolicitudCancelaciones.use-case";
import type { UpdateSolicitudCancelacionUseCase } from "../application/use-cases/UpdateSolicitudCancelacion.use-case";
import { InvalidSolicitudCancelacionRequestError } from "../domain/solicitudes-cancelaciones-errors";
import { MissingWorkflowOwnerAssignmentError } from "../domain/solicitudes-cancelaciones-errors";
import {
  createSolicitudCancelacionBodySchema,
  solicitudCancelacionByIdParamsSchema,
  solicitudCancelacionSolicitudParamsSchema,
  updateSolicitudCancelacionBodySchema,
  type CreateSolicitudCancelacionBody,
  type SolicitudCancelacionByIdParams,
  type SolicitudCancelacionSolicitudParams,
  type UpdateSolicitudCancelacionBody,
} from "./SolicitudCancelacionesRequest.schema";

type CookieRequest = Request & {
  cookies?: Record<string, string | undefined>;
};

type Dependencies = {
  createSolicitudCancelacionUseCase: CreateSolicitudCancelacionUseCase;
  deleteSolicitudCancelacionUseCase: DeleteSolicitudCancelacionUseCase;
  getCurrentUserUseCase: GetCurrentUserUseCase;
  listSolicitudCancelacionesUseCase: ListSolicitudCancelacionesUseCase;
  updateSolicitudCancelacionUseCase: UpdateSolicitudCancelacionUseCase;
};

export class SolicitudCancelacionesController {
  private readonly createSolicitudCancelacionUseCase: CreateSolicitudCancelacionUseCase;
  private readonly deleteSolicitudCancelacionUseCase: DeleteSolicitudCancelacionUseCase;
  private readonly getCurrentUserUseCase: GetCurrentUserUseCase;
  private readonly listSolicitudCancelacionesUseCase: ListSolicitudCancelacionesUseCase;
  private readonly updateSolicitudCancelacionUseCase: UpdateSolicitudCancelacionUseCase;

  constructor(dependencies: Dependencies) {
    this.createSolicitudCancelacionUseCase =
      dependencies.createSolicitudCancelacionUseCase;
    this.deleteSolicitudCancelacionUseCase =
      dependencies.deleteSolicitudCancelacionUseCase;
    this.getCurrentUserUseCase = dependencies.getCurrentUserUseCase;
    this.listSolicitudCancelacionesUseCase =
      dependencies.listSolicitudCancelacionesUseCase;
    this.updateSolicitudCancelacionUseCase =
      dependencies.updateSolicitudCancelacionUseCase;
  }

  list = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const user = await this.getCurrentUser(req);
      const params = this.parseRequest<SolicitudCancelacionSolicitudParams>(
        solicitudCancelacionSolicitudParamsSchema,
        req.params,
      );
      const cancelaciones = await this.listSolicitudCancelacionesUseCase.execute(
        {
          currentUser: {
            id: user.id,
            workflowOwnerId: user.workflowOwnerId,
          },
          solicitudId: params.id,
        },
      );

      res.status(200).json(cancelaciones);
    } catch (error) {
      next(error);
    }
  };

  create = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const user = await this.getCurrentUser(req);
      const workflowOwnerId = user.isSystemAdmin
        ? user.workflowOwnerId ?? ""
        : this.requireWorkflowOwnerId(user.workflowOwnerId);
      const params = this.parseRequest<SolicitudCancelacionSolicitudParams>(
        solicitudCancelacionSolicitudParamsSchema,
        req.params,
      );
      const body = this.parseRequest<CreateSolicitudCancelacionBody>(
        createSolicitudCancelacionBodySchema,
        req.body,
      );

      const cancelacion = await this.createSolicitudCancelacionUseCase.execute({
        cbu: body.cbu,
        createdBy: user.id,
        cuentaADebitar: body.cuentaADebitar,
        cuentaBancaria: body.cuentaBancaria,
        currentUser: {
          id: user.id,
          workflowOwnerId: user.workflowOwnerId,
          ...(user.isSystemAdmin ? { isSystemAdmin: true } : {}),
        },
        monto: body.monto,
        notas: body.notas,
        socio: body.socio,
        socioLegacyId: body.socioLegacyId,
        solicitudId: params.id,
        workflowOwnerId,
      });

      res.status(201).json(cancelacion);
    } catch (error) {
      next(error);
    }
  };

  patch = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const user = await this.getCurrentUser(req);
      const workflowOwnerId = user.isSystemAdmin
        ? user.workflowOwnerId ?? ""
        : this.requireWorkflowOwnerId(user.workflowOwnerId);
      const params = this.parseRequest<SolicitudCancelacionByIdParams>(
        solicitudCancelacionByIdParamsSchema,
        req.params,
      );
      const body = this.parseRequest<UpdateSolicitudCancelacionBody>(
        updateSolicitudCancelacionBodySchema,
        req.body,
      );

      const cancelacion = await this.updateSolicitudCancelacionUseCase.execute({
        cancelacionId: params.cancelacionId,
        cbu: body.cbu,
        cuentaADebitar: body.cuentaADebitar,
        cuentaBancaria: body.cuentaBancaria,
        currentUser: {
          id: user.id,
          workflowOwnerId: user.workflowOwnerId,
          ...(user.isSystemAdmin ? { isSystemAdmin: true } : {}),
        },
        monto: body.monto,
        notas: body.notas,
        socio: body.socio,
        socioLegacyId: body.socioLegacyId,
        solicitudId: params.id,
        workflowOwnerId,
      });

      res.status(200).json(cancelacion);
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const user = await this.getCurrentUser(req);
      const workflowOwnerId = user.isSystemAdmin
        ? user.workflowOwnerId ?? ""
        : this.requireWorkflowOwnerId(user.workflowOwnerId);
      const params = this.parseRequest<SolicitudCancelacionByIdParams>(
        solicitudCancelacionByIdParamsSchema,
        req.params,
      );

      const cancelacion = await this.deleteSolicitudCancelacionUseCase.execute({
        cancelacionId: params.cancelacionId,
        currentUser: {
          id: user.id,
          workflowOwnerId: user.workflowOwnerId,
          ...(user.isSystemAdmin ? { isSystemAdmin: true } : {}),
        },
        deletedBy: user.id,
        solicitudId: params.id,
        workflowOwnerId,
      });

      res.status(200).json(cancelacion);
    } catch (error) {
      next(error);
    }
  };

  private getCurrentUser(req: CookieRequest) {
    return this.getCurrentUserUseCase.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
  }

  private parseRequest<T>(schema: ZodSchema<T>, payload: unknown): T {
    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      throw new InvalidSolicitudCancelacionRequestError();
    }

    return parsed.data;
  }

  private requireWorkflowOwnerId(
    workflowOwnerId: string | null | undefined,
  ): string {
    if (!workflowOwnerId) {
      throw new MissingWorkflowOwnerAssignmentError();
    }

    return workflowOwnerId;
  }
}
