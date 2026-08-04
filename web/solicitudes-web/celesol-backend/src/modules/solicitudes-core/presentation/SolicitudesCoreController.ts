import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";

import type { GetCurrentUserUseCase } from "../../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import type { CreateSolicitudUseCase } from "../application/use-cases/CreateSolicitud.use-case";
import type { GetSolicitudByIdUseCase } from "../application/use-cases/GetSolicitudById.use-case";
import type { GetSolicitudesStatsUseCase } from "../application/use-cases/GetSolicitudesStats.use-case";
import type { GetVendedorDashboardStatsUseCase } from "../application/use-cases/GetVendedorDashboardStats.use-case";
import type { GetAnalistaDashboardStatsUseCase } from "../application/use-cases/GetAnalistaDashboardStats.use-case";
import type { GetAnalistaDashboardStatsV2UseCase } from "../application/use-cases/GetAnalistaDashboardStatsV2.use-case";
import type { ChangeSolicitudStateUseCase } from "../application/use-cases/ChangeSolicitudState.use-case";
import type { CreatePrestamoLegacyUseCase } from "../application/use-cases/CreatePrestamoLegacy.use-case";
import type { AssignSolicitudToSelfUseCase } from "../application/use-cases/AssignSolicitudToSelf.use-case";
import type { AssignSolicitudToUserUseCase } from "../application/use-cases/AssignSolicitudToUser.use-case";
import type { ListAssignableSolicitudAgentsUseCase } from "../application/use-cases/ListAssignableSolicitudAgents.use-case";
import type { ListSolicitudHistoryUseCase } from "../application/use-cases/ListSolicitudHistory.use-case";
import type { ListSolicitudTransitionsUseCase } from "../application/use-cases/ListSolicitudTransitions.use-case";
import type { ListSolicitudesUseCase } from "../application/use-cases/ListSolicitudes.use-case";
import type { SimularPrestamoUseCase } from "../application/use-cases/SimularPrestamo.use-case";
import type { UpdateSolicitudUseCase } from "../application/use-cases/UpdateSolicitud.use-case";
import {
  ForbiddenSolicitudAccessError,
  InvalidSolicitudesCoreRequestError,
  MissingWorkflowOwnerAssignmentError,
} from "../domain/solicitudes-core-errors";
import {
  assignSolicitudToSelfBodySchema,
  assignSolicitudToUserBodySchema,
  createSolicitudBodySchema,
  getAnalistaStatsQuerySchema,
  getSolicitudesStatsQuerySchema,
  listSolicitudesQuerySchema,
  patchSolicitudBodySchema,
  simularPrestamoBodySchema,
  solicitudByIdParamsSchema,
  type AssignSolicitudToSelfBody,
  type AssignSolicitudToUserBody,
  type CreateSolicitudBody,
  type GetAnalistaStatsQuery,
  type GetSolicitudesStatsQuery,
  type ListSolicitudesQuery,
  type PatchSolicitudBody,
  type SimularPrestamoBody,
  type SolicitudByIdParams,
} from "./SolicitudesCoreRequest.schema";
import {
  changeSolicitudStateBodySchema,
  type ChangeSolicitudStateBody,
} from "./SolicitudWorkflowRequest.schema";

type CookieRequest = Request & {
  cookies?: Record<string, string | undefined>;
};

type Dependencies = {
  assignSolicitudToSelfUseCase: AssignSolicitudToSelfUseCase;
  assignSolicitudToUserUseCase: AssignSolicitudToUserUseCase;
  listAssignableSolicitudAgentsUseCase: ListAssignableSolicitudAgentsUseCase;
  changeSolicitudStateUseCase: ChangeSolicitudStateUseCase;
  createPrestamoLegacyUseCase: CreatePrestamoLegacyUseCase;
  createSolicitudUseCase: CreateSolicitudUseCase;
  getCurrentUserUseCase: GetCurrentUserUseCase;
  getSolicitudByIdUseCase: GetSolicitudByIdUseCase;
  getSolicitudesStatsUseCase?: GetSolicitudesStatsUseCase;
  getVendedorDashboardStatsUseCase?: GetVendedorDashboardStatsUseCase;
  getAnalistaDashboardStatsUseCase?: GetAnalistaDashboardStatsUseCase;
  getAnalistaDashboardStatsV2UseCase?: GetAnalistaDashboardStatsV2UseCase;
  listSolicitudHistoryUseCase: ListSolicitudHistoryUseCase;
  listSolicitudTransitionsUseCase: ListSolicitudTransitionsUseCase;
  listSolicitudesUseCase: ListSolicitudesUseCase;
  simularPrestamoUseCase: SimularPrestamoUseCase;
  updateSolicitudUseCase: UpdateSolicitudUseCase;
};

export class SolicitudesCoreController {
  private readonly assignSolicitudToSelfUseCase: AssignSolicitudToSelfUseCase;
  private readonly assignSolicitudToUserUseCase: AssignSolicitudToUserUseCase;
  private readonly listAssignableSolicitudAgentsUseCase: ListAssignableSolicitudAgentsUseCase;
  private readonly changeSolicitudStateUseCase: ChangeSolicitudStateUseCase;
  private readonly createPrestamoLegacyUseCase: CreatePrestamoLegacyUseCase;
  private readonly createSolicitudUseCase: CreateSolicitudUseCase;
  private readonly getCurrentUserUseCase: GetCurrentUserUseCase;
  private readonly getSolicitudByIdUseCase: GetSolicitudByIdUseCase;
  private readonly getSolicitudesStatsUseCase?: GetSolicitudesStatsUseCase;
  private readonly getVendedorDashboardStatsUseCase?: GetVendedorDashboardStatsUseCase;
  private readonly getAnalistaDashboardStatsUseCase?: GetAnalistaDashboardStatsUseCase;
  private readonly getAnalistaDashboardStatsV2UseCase?: GetAnalistaDashboardStatsV2UseCase;
  private readonly listSolicitudHistoryUseCase: ListSolicitudHistoryUseCase;
  private readonly listSolicitudTransitionsUseCase: ListSolicitudTransitionsUseCase;
  private readonly listSolicitudesUseCase: ListSolicitudesUseCase;
  private readonly simularPrestamoUseCase: SimularPrestamoUseCase;
  private readonly updateSolicitudUseCase: UpdateSolicitudUseCase;

  constructor(dependencies: Dependencies) {
    this.assignSolicitudToSelfUseCase = dependencies.assignSolicitudToSelfUseCase;
    this.assignSolicitudToUserUseCase = dependencies.assignSolicitudToUserUseCase;
    this.listAssignableSolicitudAgentsUseCase =
      dependencies.listAssignableSolicitudAgentsUseCase;
    this.changeSolicitudStateUseCase = dependencies.changeSolicitudStateUseCase;
    this.createPrestamoLegacyUseCase = dependencies.createPrestamoLegacyUseCase;
    this.createSolicitudUseCase = dependencies.createSolicitudUseCase;
    this.getCurrentUserUseCase = dependencies.getCurrentUserUseCase;
    this.getSolicitudByIdUseCase = dependencies.getSolicitudByIdUseCase;
    this.getSolicitudesStatsUseCase = dependencies.getSolicitudesStatsUseCase;
    this.getVendedorDashboardStatsUseCase =
      dependencies.getVendedorDashboardStatsUseCase;
    this.getAnalistaDashboardStatsUseCase =
      dependencies.getAnalistaDashboardStatsUseCase;
    this.getAnalistaDashboardStatsV2UseCase =
      dependencies.getAnalistaDashboardStatsV2UseCase;
    this.listSolicitudHistoryUseCase = dependencies.listSolicitudHistoryUseCase;
    this.listSolicitudTransitionsUseCase =
      dependencies.listSolicitudTransitionsUseCase;
    this.listSolicitudesUseCase = dependencies.listSolicitudesUseCase;
    this.simularPrestamoUseCase = dependencies.simularPrestamoUseCase;
    this.updateSolicitudUseCase = dependencies.updateSolicitudUseCase;
  }

  create = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const user = await this.getCurrentUser(req);
      this.requireWorkflowOwnerId(user.workflowOwnerId);
      const body = this.parseRequest<CreateSolicitudBody>(
        createSolicitudBodySchema,
        req.body,
      );
      const solicitud = await this.createSolicitudUseCase.execute({
        ...body,
        authenticatedSellerName: formatAuthenticatedSellerName(
          user.firstName,
          user.lastName,
        ),
        createdBy: user.id,
        createdByLegacyUser: user.legacyUser,
      });

      res.status(201).json(solicitud);
    } catch (error) {
      next(error);
    }
  };

  getStats = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const user = await this.getCurrentUser(req);

      if (!user.isSystemAdmin) {
        throw new ForbiddenSolicitudAccessError();
      }

      const query = this.parseRequest<GetSolicitudesStatsQuery>(
        getSolicitudesStatsQuerySchema,
        req.query,
      );
      const stats = await this.getSolicitudesStatsUseCase!.execute(query);
      res.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  };

  getVendedorStats = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = await this.getCurrentUser(req);
      const query = this.parseRequest<GetSolicitudesStatsQuery>(
        getSolicitudesStatsQuerySchema,
        req.query,
      );
      const stats = await this.getVendedorDashboardStatsUseCase!.execute({
        ...query,
        vendedorId: user.id,
      });

      res.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  };

  getAnalistaStats = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = await this.getCurrentUser(req);
      const query = this.parseRequest<GetAnalistaStatsQuery>(
        getAnalistaStatsQuerySchema,
        req.query,
      );
      const stats = await this.getAnalistaDashboardStatsUseCase!.execute({
        ...query,
        analistaId: user.id,
        umbralDias: query.umbralDias ?? 7,
        vista: query.vista ?? "mis_casos",
        workflowOwnerId: user.workflowOwnerId,
      });

      res.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  };

  getAnalistaStatsV2 = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = await this.getCurrentUser(req);
      const query = this.parseRequest<GetAnalistaStatsQuery>(
        getAnalistaStatsQuerySchema,
        req.query,
      );
      const stats = await this.getAnalistaDashboardStatsV2UseCase!.execute({
        ...query,
        analistaId: user.id,
        umbralDias: query.umbralDias ?? 7,
        vista: query.vista ?? "mis_casos",
        workflowOwnerId: user.workflowOwnerId,
      });

      res.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  };

  list = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const user = await this.getCurrentUser(req);
      const query = this.parseRequest<ListSolicitudesQuery>(
        listSolicitudesQuerySchema,
        req.query,
      );
      const workflowOwnerId =
        query.scope === "work" && !user.isSystemAdmin
          ? this.requireWorkflowOwnerId(user.workflowOwnerId)
          : undefined;
      const solicitudes = await this.listSolicitudesUseCase.execute({
        ...query,
        currentUser: {
          id: user.id,
          workflowOwnerId: user.workflowOwnerId,
          ...(user.isSystemAdmin ? { isSystemAdmin: true } : {}),
        },
        ...(workflowOwnerId ? { workflowOwnerId } : {}),
      });

      res.status(200).json(solicitudes);
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const user = await this.getCurrentUser(req);
      const params = this.parseRequest<SolicitudByIdParams>(
        solicitudByIdParamsSchema,
        req.params,
      );
      const solicitud = await this.getSolicitudByIdUseCase.execute({
        currentUser: {
          id: user.id,
          workflowOwnerId: user.workflowOwnerId,
          ...(user.isSystemAdmin ? { isSystemAdmin: true } : {}),
        },
        id: params.id,
      });

      res.status(200).json(solicitud);
    } catch (error) {
      next(error);
    }
  };

  listTransitions = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = await this.getCurrentUser(req);
      const workflowOwnerId = user.isSystemAdmin
        ? user.workflowOwnerId ?? ""
        : this.requireWorkflowOwnerId(user.workflowOwnerId);
      const params = this.parseRequest<SolicitudByIdParams>(
        solicitudByIdParamsSchema,
        req.params,
      );
      const transitions =
        await this.listSolicitudTransitionsUseCase.execute({
          solicitudId: params.id,
          workflowOwnerId,
          ...(user.isSystemAdmin ? { isSystemAdmin: true } : {}),
        });

      res.status(200).json(transitions);
    } catch (error) {
      next(error);
    }
  };

  changeState = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = await this.getCurrentUser(req);
      const workflowOwnerId = user.isSystemAdmin
        ? user.workflowOwnerId ?? ""
        : this.requireWorkflowOwnerId(user.workflowOwnerId);
      const params = this.parseRequest<SolicitudByIdParams>(
        solicitudByIdParamsSchema,
        req.params,
      );
      const body = this.parseRequest<ChangeSolicitudStateBody>(
        changeSolicitudStateBodySchema,
        req.body,
      );
      const result = await this.changeSolicitudStateUseCase.execute({
        actionCode: body.actionCode,
        comment: body.comment,
        currentUser: {
          id: user.id,
          workflowOwnerId,
          ...(user.isSystemAdmin ? { isSystemAdmin: true } : {}),
        },
        motivo: body.reason,
        solicitudId: params.id,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  createPrestamoLegacy = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = await this.getCurrentUser(req);
      const workflowOwnerId = user.isSystemAdmin
        ? user.workflowOwnerId ?? ""
        : this.requireWorkflowOwnerId(user.workflowOwnerId);
      const params = this.parseRequest<SolicitudByIdParams>(
        solicitudByIdParamsSchema,
        req.params,
      );
      const solicitud = await this.createPrestamoLegacyUseCase.execute({
        currentUser: {
          id: user.id,
          workflowOwnerId,
          ...(user.isSystemAdmin ? { isSystemAdmin: true } : {}),
        },
        solicitudId: params.id,
      });

      res.status(200).json(solicitud);
    } catch (error) {
      next(error);
    }
  };

  listHistory = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = await this.getCurrentUser(req);
      const params = this.parseRequest<SolicitudByIdParams>(
        solicitudByIdParamsSchema,
        req.params,
      );
      const history = await this.listSolicitudHistoryUseCase.execute({
        currentUser: {
          id: user.id,
          workflowOwnerId: user.workflowOwnerId,
        },
        solicitudId: params.id,
      });

      res.status(200).json(history);
    } catch (error) {
      next(error);
    }
  };

  update = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const user = await this.getCurrentUser(req);

      if (!user.isSystemAdmin) {
        this.requireWorkflowOwnerId(user.workflowOwnerId);
      }

      const params = this.parseRequest<SolicitudByIdParams>(
        solicitudByIdParamsSchema,
        req.params,
      );
      const body = this.parseRequest<PatchSolicitudBody>(
        patchSolicitudBodySchema,
        req.body,
      );

      if (
        body.solicitud === undefined &&
        body.titular === undefined &&
        body.datosLaborales === undefined &&
        body.conyuge === undefined &&
        body.garantias === undefined
      ) {
        throw new InvalidSolicitudesCoreRequestError();
      }

      const solicitud = await this.updateSolicitudUseCase.execute({
        ...body,
        currentUser: {
          id: user.id,
          workflowOwnerId: user.workflowOwnerId,
          ...(user.isSystemAdmin ? { isSystemAdmin: true } : {}),
        },
        createdBy: user.id,
        createdByLegacyUser: user.legacyUser,
        id: params.id,
      });

      res.status(200).json(solicitud);
    } catch (error) {
      next(error);
    }
  };

  assignToSelf = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const params = this.parseRequest<SolicitudByIdParams>(
        solicitudByIdParamsSchema,
        req.params,
      );
      this.parseRequest<AssignSolicitudToSelfBody>(
        assignSolicitudToSelfBodySchema,
        req.body,
      );
      const authenticatedUser = await this.getCurrentUser(req);
      const solicitud = await this.assignSolicitudToSelfUseCase.execute({
        currentUser: {
          id: authenticatedUser.id,
          workflowOwnerId: authenticatedUser.workflowOwnerId,
          ...(authenticatedUser.isSystemAdmin ? { isSystemAdmin: true } : {}),
        },
        solicitudId: params.id,
      });

      res.status(200).json(solicitud);
    } catch (error) {
      next(error);
    }
  };

  assignToUser = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const params = this.parseRequest<SolicitudByIdParams>(
        solicitudByIdParamsSchema,
        req.params,
      );
      const body = this.parseRequest<AssignSolicitudToUserBody>(
        assignSolicitudToUserBodySchema,
        req.body,
      );
      const authenticatedUser = await this.getCurrentUser(req);
      const solicitud = await this.assignSolicitudToUserUseCase.execute({
        currentUser: {
          id: authenticatedUser.id,
          workflowOwnerId: authenticatedUser.workflowOwnerId,
          ...(authenticatedUser.isSystemAdmin ? { isSystemAdmin: true } : {}),
        },
        solicitudId: params.id,
        targetUserId: body.targetUserId,
      });

      res.status(200).json(solicitud);
    } catch (error) {
      next(error);
    }
  };

  listAssignableAgents = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = await this.getCurrentUser(req);
      const params = this.parseRequest<SolicitudByIdParams>(
        solicitudByIdParamsSchema,
        req.params,
      );
      const agents = await this.listAssignableSolicitudAgentsUseCase.execute({
        currentUser: {
          id: user.id,
          ...(user.isSystemAdmin ? { isSystemAdmin: true } : {}),
          workflowOwnerId: user.workflowOwnerId,
        },
        solicitudId: params.id,
      });

      res.status(200).json(agents);
    } catch (error) {
      next(error);
    }
  };

  simular = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const user = await this.getCurrentUser(req);
      const body = this.parseRequest<SimularPrestamoBody>(
        simularPrestamoBodySchema,
        req.body,
      );
      const simulacion = await this.simularPrestamoUseCase.execute({
        capitalPuro: body.capitalPuro ?? false,
        cuotas: body.cuotas,
        fechaPrimerVencimiento: body.fechaPrimerVencimiento,
        legacyUser: user.legacyUser,
        lineaId: body.lineaId,
        montoAFinanciar: body.montoAFinanciar,
        tasa: body.tasa,
      });

      res.status(200).json(simulacion);
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
      throw new InvalidSolicitudesCoreRequestError();
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

function formatAuthenticatedSellerName(
  firstName: string | null,
  lastName: string | null,
) {
  return `${firstName ?? ""} ${lastName ?? ""}`
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const normalizedWord = word.toLowerCase();

      return (
        normalizedWord.charAt(0).toUpperCase() + normalizedWord.slice(1)
      );
    })
    .join(" ");
}
