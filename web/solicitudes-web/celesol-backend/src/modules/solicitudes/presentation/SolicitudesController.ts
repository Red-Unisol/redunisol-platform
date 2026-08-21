import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";

import type { GetCurrentUserUseCase } from "../../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import type { GetLineasPrestamoUseCase } from "../application/use-cases/GetLineasPrestamo.use-case";
import type { GetSocioMutualCancelacionDetalleUseCase } from "../application/use-cases/GetSocioMutualCancelacionDetalle.use-case";
import type { GetSocioMutualUseCase } from "../application/use-cases/GetSocioMutual.use-case";
import type { GetSolicitudDetalleUseCase } from "../application/use-cases/GetSolicitudDetalle.use-case";
import type { GetSolicitudDetailByOidUseCase } from "../application/use-cases/GetSolicitudDetailByOid.use-case";
import type { GetSolicitudesHistoricasUseCase } from "../application/use-cases/GetSolicitudesHistoricas.use-case";
import type { GetSolicitudesPrecargaUseCase } from "../application/use-cases/GetSolicitudesPrecarga.use-case";
import type { GetSolicitudesRecientesUseCase } from "../application/use-cases/GetSolicitudesRecientes.use-case";
import type { ListSociosCancelacionesUseCase } from "../application/use-cases/ListSociosCancelaciones.use-case";
import {
  InvalidSolicitudesRequestError,
  MissingWorkflowOwnerAssignmentError,
  SocioMutualCancelacionNotFoundError,
} from "../domain/solicitudes-errors";
import {
  solicitudDetalleQuerySchema,
  solicitudDetailByOidQuerySchema,
  solicitudesHistoricasQuerySchema,
  solicitudesPrecargaQuerySchema,
  solicitudesRecientesQuerySchema,
  socioMutualCancelacionDetalleQuerySchema,
  socioMutualQuerySchema,
  type MaxQuery,
  type SocioMutualCancelacionDetalleQuery,
  type SocioMutualQuery,
  type SolicitudDetalleQuery,
  type SolicitudDetailByOidQuery,
} from "./SolicitudesRequest.schema";

type CookieRequest = Request & {
  cookies?: Record<string, string | undefined>;
};

type Dependencies = {
  getCurrentUserUseCase: GetCurrentUserUseCase;
  getLineasPrestamoUseCase: GetLineasPrestamoUseCase;
  getSocioMutualCancelacionDetalleUseCase: GetSocioMutualCancelacionDetalleUseCase;
  getSocioMutualUseCase: GetSocioMutualUseCase;
  getSolicitudDetalleUseCase: GetSolicitudDetalleUseCase;
  getSolicitudDetailByOidUseCase: GetSolicitudDetailByOidUseCase;
  getSolicitudesHistoricasUseCase: GetSolicitudesHistoricasUseCase;
  getSolicitudesPrecargaUseCase: GetSolicitudesPrecargaUseCase;
  getSolicitudesRecientesUseCase: GetSolicitudesRecientesUseCase;
  listSociosCancelacionesUseCase: ListSociosCancelacionesUseCase;
};

export class SolicitudesController {
  private readonly getCurrentUserUseCase: GetCurrentUserUseCase;
  private readonly getLineasPrestamoUseCase: GetLineasPrestamoUseCase;
  private readonly getSocioMutualCancelacionDetalleUseCase: GetSocioMutualCancelacionDetalleUseCase;
  private readonly getSocioMutualUseCase: GetSocioMutualUseCase;
  private readonly getSolicitudDetalleUseCase: GetSolicitudDetalleUseCase;
  private readonly getSolicitudDetailByOidUseCase: GetSolicitudDetailByOidUseCase;
  private readonly getSolicitudesHistoricasUseCase: GetSolicitudesHistoricasUseCase;
  private readonly getSolicitudesPrecargaUseCase: GetSolicitudesPrecargaUseCase;
  private readonly getSolicitudesRecientesUseCase: GetSolicitudesRecientesUseCase;
  private readonly listSociosCancelacionesUseCase: ListSociosCancelacionesUseCase;

  constructor(dependencies: Dependencies) {
    this.getCurrentUserUseCase = dependencies.getCurrentUserUseCase;
    this.getLineasPrestamoUseCase = dependencies.getLineasPrestamoUseCase;
    this.getSocioMutualCancelacionDetalleUseCase =
      dependencies.getSocioMutualCancelacionDetalleUseCase;
    this.getSocioMutualUseCase = dependencies.getSocioMutualUseCase;
    this.getSolicitudDetalleUseCase = dependencies.getSolicitudDetalleUseCase;
    this.getSolicitudDetailByOidUseCase =
      dependencies.getSolicitudDetailByOidUseCase;
    this.getSolicitudesHistoricasUseCase =
      dependencies.getSolicitudesHistoricasUseCase;
    this.getSolicitudesPrecargaUseCase =
      dependencies.getSolicitudesPrecargaUseCase;
    this.getSolicitudesRecientesUseCase =
      dependencies.getSolicitudesRecientesUseCase;
    this.listSociosCancelacionesUseCase =
      dependencies.listSociosCancelacionesUseCase;
  }

  precarga = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const user = await this.getCurrentUser(req);
      const query = this.parseQuery<MaxQuery>(
        solicitudesPrecargaQuerySchema,
        req.query,
      );
      const rows = await this.getSolicitudesPrecargaUseCase.execute({
        legacyUser: user.legacyUser,
        max: query.max,
      });

      res.status(200).json(rows);
    } catch (error) {
      next(error);
    }
  };

  recientes = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const user = await this.getCurrentUser(req);
      const query = this.parseQuery<MaxQuery>(
        solicitudesRecientesQuerySchema,
        req.query,
      );
      const rows = await this.getSolicitudesRecientesUseCase.execute({
        legacyUser: user.legacyUser,
        max: query.max,
      });

      res.status(200).json(rows);
    } catch (error) {
      next(error);
    }
  };

  historicas = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = await this.getCurrentUser(req);
      const query = this.parseQuery<MaxQuery>(
        solicitudesHistoricasQuerySchema,
        req.query,
      );
      const rows = await this.getSolicitudesHistoricasUseCase.execute({
        legacyUser: user.legacyUser,
        max: query.max,
      });

      res.status(200).json(rows);
    } catch (error) {
      next(error);
    }
  };

  detalle = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      await this.getCurrentUser(req);
      const query = this.parseQuery<SolicitudDetalleQuery>(
        solicitudDetalleQuerySchema,
        req.query,
      );
      const rows = await this.getSolicitudDetalleUseCase.execute({
        nroSolicitud: query.nroSolicitud,
      });

      res.status(200).json(rows);
    } catch (error) {
      next(error);
    }
  };

  detail = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      await this.getCurrentUser(req);
      const query = this.parseQuery<SolicitudDetailByOidQuery>(
        solicitudDetailByOidQuerySchema,
        req.query,
      );
      const detail = await this.getSolicitudDetailByOidUseCase.execute({
        oid: query.oid,
      });

      res.status(200).json(detail);
    } catch (error) {
      next(error);
    }
  };

  socio = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      await this.getCurrentUser(req);
      const query = this.parseQuery<SocioMutualQuery>(
        socioMutualQuerySchema,
        req.query,
      );
      const rows = await this.getSocioMutualUseCase.execute({
        dni: query.dni,
      });

      res.status(200).json(rows);
    } catch (error) {
      next(error);
    }
  };

  lineasPrestamo = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = await this.getCurrentUser(req);
      const rows = await this.getLineasPrestamoUseCase.execute({
        legacyUser: user.legacyUser,
        max: 1,
      });

      res.status(200).json(rows);
    } catch (error) {
      next(error);
    }
  };

  sociosCancelaciones = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await this.getCurrentUser(req);
      const rows = await this.listSociosCancelacionesUseCase.execute();

      res.status(200).json(rows);
    } catch (error) {
      next(error);
    }
  };

  socioCancelacionDetalle = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await this.getCurrentUser(req);
      const query = this.parseQuery<SocioMutualCancelacionDetalleQuery>(
        socioMutualCancelacionDetalleQuerySchema,
        req.query,
      );
      const detalle = await this.getSocioMutualCancelacionDetalleUseCase.execute({
        id: query.id,
      });

      if (!detalle) {
        throw new SocioMutualCancelacionNotFoundError();
      }

      res.status(200).json(detalle);
    } catch (error) {
      next(error);
    }
  };

  private getCurrentUser(req: CookieRequest) {
    return this.getCurrentUserUseCase
      .execute(req.cookies?.[ACCESS_TOKEN_COOKIE])
      .then((user) => {
        if (!user.isSystemAdmin && !user.workflowOwnerId) {
          throw new MissingWorkflowOwnerAssignmentError();
        }

        return user;
      });
  }

  private parseQuery<T>(schema: ZodSchema<T>, query: unknown): T {
    const parsed = schema.safeParse(query);

    if (!parsed.success) {
      throw new InvalidSolicitudesRequestError();
    }

    return parsed.data;
  }
}
