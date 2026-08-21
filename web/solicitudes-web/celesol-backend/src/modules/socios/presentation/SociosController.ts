import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";

import type { GetCurrentUserUseCase } from "../../auth/application/use-cases/GetCurrentUser.use-case";
import type { AuthUser } from "../../auth/domain/entities/User.entity";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import type { CheckSocioCuitDuplicateUseCase } from "../application/use-cases/CheckSocioCuitDuplicate.use-case";
import type { CheckSocioDocumentoDuplicateUseCase } from "../application/use-cases/CheckSocioDocumentoDuplicate.use-case";
import type { CreateSocioUseCase } from "../application/use-cases/CreateSocio.use-case";
import type { DeleteSocioUseCase } from "../application/use-cases/DeleteSocio.use-case";
import type { GetSocioByIdUseCase } from "../application/use-cases/GetSocioById.use-case";
import type { ListSociosUseCase } from "../application/use-cases/ListSocios.use-case";
import type { LookupSocioByDocumentoUseCase } from "../application/use-cases/LookupSocioByDocumento.use-case";
import type { SyncSociosFromVimaxUseCase } from "../application/use-cases/SyncSociosFromVimax.use-case";
import type { UpdateSocioUseCase } from "../application/use-cases/UpdateSocio.use-case";
import {
  ForbiddenSocioCreationError,
  ForbiddenSocioDeleteError,
  ForbiddenSocioUpdateError,
  InvalidSocioRequestError,
} from "../domain/socios-errors";
import {
  checkCuitQuerySchema,
  type CheckCuitQuery,
} from "./CheckCuitQuery.schema";
import {
  checkDocumentoQuerySchema,
  type CheckDocumentoQuery,
} from "./CheckDocumentoQuery.schema";
import {
  createSocioBodySchema,
  type CreateSocioBody,
} from "./CreateSocioRequest.schema";
import {
  listSociosQuerySchema,
  type ListSociosQuery,
} from "./ListSociosQuery.schema";
import {
  lookupSocioQuerySchema,
  type LookupSocioQuery,
} from "./LookupSocioQuery.schema";
import { toLookupSocioResponse } from "./LookupSocioResponse.mapper";
import { toSocioListResponse, toSocioResponse } from "./SocioResponse.mapper";
import { socioIdParamsSchema, type SocioIdParams } from "./SocioParams.schema";
import {
  updateSocioBodySchema,
  type UpdateSocioBody,
} from "./UpdateSocioRequest.schema";

type CookieRequest = Request & {
  cookies?: Record<string, string | undefined>;
};

type Dependencies = {
  checkSocioCuitDuplicateUseCase: CheckSocioCuitDuplicateUseCase;
  checkSocioDocumentoDuplicateUseCase: CheckSocioDocumentoDuplicateUseCase;
  createSocioUseCase: CreateSocioUseCase;
  deleteSocioUseCase: DeleteSocioUseCase;
  getCurrentUserUseCase: GetCurrentUserUseCase;
  getSocioByIdUseCase: GetSocioByIdUseCase;
  listSociosUseCase: ListSociosUseCase;
  lookupSocioByDocumentoUseCase: LookupSocioByDocumentoUseCase;
  syncSociosFromVimaxUseCase: SyncSociosFromVimaxUseCase;
  updateSocioUseCase: UpdateSocioUseCase;
};

export class SociosController {
  private readonly checkSocioCuitDuplicateUseCase: CheckSocioCuitDuplicateUseCase;
  private readonly checkSocioDocumentoDuplicateUseCase: CheckSocioDocumentoDuplicateUseCase;
  private readonly createSocioUseCase: CreateSocioUseCase;
  private readonly deleteSocioUseCase: DeleteSocioUseCase;
  private readonly getCurrentUserUseCase: GetCurrentUserUseCase;
  private readonly getSocioByIdUseCase: GetSocioByIdUseCase;
  private readonly listSociosUseCase: ListSociosUseCase;
  private readonly lookupSocioByDocumentoUseCase: LookupSocioByDocumentoUseCase;
  private readonly syncSociosFromVimaxUseCase: SyncSociosFromVimaxUseCase;
  private readonly updateSocioUseCase: UpdateSocioUseCase;

  constructor(dependencies: Dependencies) {
    this.checkSocioCuitDuplicateUseCase =
      dependencies.checkSocioCuitDuplicateUseCase;
    this.checkSocioDocumentoDuplicateUseCase =
      dependencies.checkSocioDocumentoDuplicateUseCase;
    this.createSocioUseCase = dependencies.createSocioUseCase;
    this.deleteSocioUseCase = dependencies.deleteSocioUseCase;
    this.getCurrentUserUseCase = dependencies.getCurrentUserUseCase;
    this.getSocioByIdUseCase = dependencies.getSocioByIdUseCase;
    this.listSociosUseCase = dependencies.listSociosUseCase;
    this.lookupSocioByDocumentoUseCase =
      dependencies.lookupSocioByDocumentoUseCase;
    this.syncSociosFromVimaxUseCase = dependencies.syncSociosFromVimaxUseCase;
    this.updateSocioUseCase = dependencies.updateSocioUseCase;
  }

  create = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const currentUser = await this.getCurrentUser(req);

      if (!this.isRiesgoOrAdmin(currentUser)) {
        throw new ForbiddenSocioCreationError();
      }

      const body = this.parseRequest<CreateSocioBody>(
        createSocioBodySchema,
        req.body,
      );
      const socio = await this.createSocioUseCase.execute(body);

      res.status(201).json(toSocioResponse(socio));
    } catch (error) {
      next(error);
    }
  };

  list = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      await this.getCurrentUser(req);
      const query = this.parseRequest<ListSociosQuery>(
        listSociosQuerySchema,
        req.query,
      );
      const result = await this.listSociosUseCase.execute(query);

      res.status(200).json({
        items: toSocioListResponse(result.items),
        total: result.total,
      });
    } catch (error) {
      next(error);
    }
  };

  lookup = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      await this.getCurrentUser(req);
      const query = this.parseRequest<LookupSocioQuery>(
        lookupSocioQuerySchema,
        req.query,
      );
      const result = await this.lookupSocioByDocumentoUseCase.execute(query);

      res.status(200).json(toLookupSocioResponse(result));
    } catch (error) {
      next(error);
    }
  };

  checkCuit = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      await this.getCurrentUser(req);
      const query = this.parseRequest<CheckCuitQuery>(
        checkCuitQuerySchema,
        req.query,
      );
      const result = await this.checkSocioCuitDuplicateUseCase.execute({
        cuit: query.cuit,
        excludeSocioId: query.excludeSocioId,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  checkDocumento = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await this.getCurrentUser(req);
      const query = this.parseRequest<CheckDocumentoQuery>(
        checkDocumentoQuerySchema,
        req.query,
      );
      const result = await this.checkSocioDocumentoDuplicateUseCase.execute({
        excludeSocioId: query.excludeSocioId,
        nroDocumento: query.nroDocumento,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      await this.getCurrentUser(req);
      const params = this.parseRequest<SocioIdParams>(
        socioIdParamsSchema,
        req.params,
      );
      const socio = await this.getSocioByIdUseCase.execute({
        id: params.id,
      });

      res.status(200).json(toSocioResponse(socio));
    } catch (error) {
      next(error);
    }
  };

  update = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const currentUser = await this.getCurrentUser(req);

      if (!this.isRiesgoOrAdmin(currentUser)) {
        throw new ForbiddenSocioUpdateError();
      }

      const params = this.parseRequest<SocioIdParams>(
        socioIdParamsSchema,
        req.params,
      );
      const body = this.parseRequest<UpdateSocioBody>(
        updateSocioBodySchema,
        req.body,
      );
      const socio = await this.updateSocioUseCase.execute({
        body,
        id: params.id,
      });

      res.status(200).json(toSocioResponse(socio));
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const currentUser = await this.getCurrentUser(req);

      if (!this.isRiesgoOrAdmin(currentUser)) {
        throw new ForbiddenSocioDeleteError();
      }

      const params = this.parseRequest<SocioIdParams>(
        socioIdParamsSchema,
        req.params,
      );

      await this.deleteSocioUseCase.execute({
        id: params.id,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  syncFromLegacy = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await this.getCurrentUser(req);
      const result = await this.syncSociosFromVimaxUseCase.execute();

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  private getCurrentUser(req: CookieRequest) {
    return this.getCurrentUserUseCase.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
  }

  private isRiesgoOrAdmin(user: AuthUser): boolean {
    return user.isSystemAdmin || user.workflowOwner?.code === "RIESGO";
  }

  private parseRequest<T>(schema: ZodSchema<T>, payload: unknown): T {
    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      throw new InvalidSocioRequestError("Request invalido.");
    }

    return parsed.data;
  }
}
