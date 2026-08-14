import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";

import type { GetCurrentUserUseCase } from "../../../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../../../auth/presentation/AuthCookies";
import type { DeleteSolicitudAdjuntoUseCase } from "../application/use-cases/DeleteSolicitudAdjunto.use-case";
import type { DownloadSolicitudAdjuntoUseCase } from "../application/use-cases/DownloadSolicitudAdjunto.use-case";
import type { ListSolicitudAdjuntosUseCase } from "../application/use-cases/ListSolicitudAdjuntos.use-case";
import type { UpdateSolicitudAdjuntoUseCase } from "../application/use-cases/UpdateSolicitudAdjunto.use-case";
import type { UploadSolicitudAdjuntoUseCase } from "../application/use-cases/UploadSolicitudAdjunto.use-case";
import type { UploadSolicitudAdjuntosBatchUseCase } from "../application/use-cases/UploadSolicitudAdjuntosBatch.use-case";
import { TIPOS_ADJUNTO_CATALOG } from "../domain/TiposAdjuntoCatalog";
import { InvalidSolicitudAdjuntoRequestError } from "../domain/solicitudes-adjuntos-errors";
import { MissingWorkflowOwnerAssignmentError } from "../domain/solicitudes-adjuntos-errors";
import {
  deleteSolicitudAdjuntoBodySchema,
  patchSolicitudAdjuntoBodySchema,
  solicitudAdjuntoByIdParamsSchema,
  solicitudAdjuntoSolicitudParamsSchema,
  uploadSolicitudAdjuntoBodySchema,
  uploadSolicitudAdjuntosBatchBodySchema,
  type DeleteSolicitudAdjuntoBody,
  type PatchSolicitudAdjuntoBody,
  type SolicitudAdjuntoByIdParams,
  type SolicitudAdjuntoSolicitudParams,
  type UploadSolicitudAdjuntoBody,
  type UploadSolicitudAdjuntosBatchBody,
} from "./SolicitudAdjuntosRequest.schema";

type CookieRequest = Request & {
  cookies?: Record<string, string | undefined>;
};

type Dependencies = {
  deleteSolicitudAdjuntoUseCase: DeleteSolicitudAdjuntoUseCase;
  downloadSolicitudAdjuntoUseCase: DownloadSolicitudAdjuntoUseCase;
  getCurrentUserUseCase: GetCurrentUserUseCase;
  listSolicitudAdjuntosUseCase: ListSolicitudAdjuntosUseCase;
  updateSolicitudAdjuntoUseCase: UpdateSolicitudAdjuntoUseCase;
  uploadSolicitudAdjuntoUseCase: UploadSolicitudAdjuntoUseCase;
  uploadSolicitudAdjuntosBatchUseCase: UploadSolicitudAdjuntosBatchUseCase;
};

export class SolicitudAdjuntosController {
  private readonly deleteSolicitudAdjuntoUseCase: DeleteSolicitudAdjuntoUseCase;
  private readonly downloadSolicitudAdjuntoUseCase: DownloadSolicitudAdjuntoUseCase;
  private readonly getCurrentUserUseCase: GetCurrentUserUseCase;
  private readonly listSolicitudAdjuntosUseCase: ListSolicitudAdjuntosUseCase;
  private readonly updateSolicitudAdjuntoUseCase: UpdateSolicitudAdjuntoUseCase;
  private readonly uploadSolicitudAdjuntoUseCase: UploadSolicitudAdjuntoUseCase;
  private readonly uploadSolicitudAdjuntosBatchUseCase: UploadSolicitudAdjuntosBatchUseCase;

  constructor(dependencies: Dependencies) {
    this.deleteSolicitudAdjuntoUseCase =
      dependencies.deleteSolicitudAdjuntoUseCase;
    this.downloadSolicitudAdjuntoUseCase =
      dependencies.downloadSolicitudAdjuntoUseCase;
    this.getCurrentUserUseCase = dependencies.getCurrentUserUseCase;
    this.listSolicitudAdjuntosUseCase = dependencies.listSolicitudAdjuntosUseCase;
    this.updateSolicitudAdjuntoUseCase =
      dependencies.updateSolicitudAdjuntoUseCase;
    this.uploadSolicitudAdjuntoUseCase =
      dependencies.uploadSolicitudAdjuntoUseCase;
    this.uploadSolicitudAdjuntosBatchUseCase =
      dependencies.uploadSolicitudAdjuntosBatchUseCase;
  }

  upload = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const user = await this.getCurrentUser(req);
      const workflowOwnerId = user.isSystemAdmin
        ? user.workflowOwnerId ?? ""
        : this.requireWorkflowOwnerId(user.workflowOwnerId);
      const params = this.parseRequest<SolicitudAdjuntoSolicitudParams>(
        solicitudAdjuntoSolicitudParamsSchema,
        req.params,
      );
      const body = this.parseRequest<UploadSolicitudAdjuntoBody>(
        uploadSolicitudAdjuntoBodySchema,
        req.body,
      );

      if (!req.file) {
        throw new InvalidSolicitudAdjuntoRequestError("Archivo requerido.");
      }

      const adjunto = await this.uploadSolicitudAdjuntoUseCase.execute({
        adicional: body.adicional,
        comentario: body.comentario,
        createdBy: user.id,
        currentUser: {
          id: user.id,
          workflowOwnerId: user.workflowOwnerId,
          ...(user.isSystemAdmin ? { isSystemAdmin: true } : {}),
        },
        descripcion: body.descripcion,
        file: {
          buffer: req.file.buffer,
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
        },
        nroDocumento: body.nroDocumento,
        restringido: body.restringido,
        solicitudId: params.id,
        tipoAdjunto: body.tipoAdjunto,
        workflowOwnerId,
      });

      res.status(201).json(adjunto);
    } catch (error) {
      next(error);
    }
  };

  uploadBatch = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = await this.getCurrentUser(req);
      const workflowOwnerId = user.isSystemAdmin
        ? user.workflowOwnerId ?? ""
        : this.requireWorkflowOwnerId(user.workflowOwnerId);
      const params = this.parseRequest<SolicitudAdjuntoSolicitudParams>(
        solicitudAdjuntoSolicitudParamsSchema,
        req.params,
      );
      const body = this.parseRequest<UploadSolicitudAdjuntosBatchBody>(
        uploadSolicitudAdjuntosBatchBodySchema,
        req.body,
      );
      const files = req.files;

      if (!Array.isArray(files) || files.length === 0) {
        throw new InvalidSolicitudAdjuntoRequestError(
          "Debe incluir al menos un archivo.",
        );
      }

      if (files.length !== body.metadata.length) {
        throw new InvalidSolicitudAdjuntoRequestError(
          "La cantidad de archivos no coincide con la cantidad de metadatos enviados.",
        );
      }

      const adjuntos = await this.uploadSolicitudAdjuntosBatchUseCase.execute({
        createdBy: user.id,
        currentUser: {
          id: user.id,
          workflowOwnerId: user.workflowOwnerId,
          ...(user.isSystemAdmin ? { isSystemAdmin: true } : {}),
        },
        files: files.map((file, index) => ({
          adicional: body.metadata[index]?.adicional,
          comentario: body.metadata[index]?.comentario,
          descripcion: body.metadata[index]?.descripcion,
          file: {
            buffer: file.buffer,
            fileName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
          },
          nroDocumento: body.metadata[index]?.nroDocumento,
          restringido: body.metadata[index]?.restringido,
          tipoAdjunto: body.metadata[index]!.tipoAdjunto,
        })),
        solicitudId: params.id,
        workflowOwnerId,
      });

      res.status(201).json(adjuntos);
    } catch (error) {
      next(error);
    }
  };

  list = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const user = await this.getCurrentUser(req);
      const params = this.parseRequest<SolicitudAdjuntoSolicitudParams>(
        solicitudAdjuntoSolicitudParamsSchema,
        req.params,
      );
      const adjuntos = await this.listSolicitudAdjuntosUseCase.execute({
        currentUser: {
          id: user.id,
          workflowOwnerId: user.workflowOwnerId,
        },
        solicitudId: params.id,
      });

      res.status(200).json(adjuntos);
    } catch (error) {
      next(error);
    }
  };

  listTiposAdjunto = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await this.getCurrentUser(req);
      res.status(200).json(TIPOS_ADJUNTO_CATALOG);
    } catch (error) {
      next(error);
    }
  };

  download = async (req: CookieRequest, res: Response, next: NextFunction) => {
    try {
      const user = await this.getCurrentUser(req);
      const params = this.parseRequest<SolicitudAdjuntoByIdParams>(
        solicitudAdjuntoByIdParamsSchema,
        req.params,
      );
      const { adjunto, stream } =
        await this.downloadSolicitudAdjuntoUseCase.execute({
          adjuntoId: params.adjuntoId,
          currentUser: {
            id: user.id,
            workflowOwnerId: user.workflowOwnerId,
          },
          solicitudId: params.id,
        });

      const fileName = (adjunto.archivoNombre ?? adjunto.id).replace(/"/g, "");

      res.status(200);
      res.setHeader(
        "Content-Type",
        adjunto.archivoMimeType ?? "application/octet-stream",
      );

      if (adjunto.archivoSizeBytes !== null) {
        res.setHeader("Content-Length", String(adjunto.archivoSizeBytes));
      }

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`,
      );

      stream.on("error", next);
      stream.pipe(res);
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
      const params = this.parseRequest<SolicitudAdjuntoByIdParams>(
        solicitudAdjuntoByIdParamsSchema,
        req.params,
      );
      const body = this.parseRequest<PatchSolicitudAdjuntoBody>(
        patchSolicitudAdjuntoBodySchema,
        req.body,
      );

      const adjunto = await this.updateSolicitudAdjuntoUseCase.execute({
        adicional: body.adicional,
        adjuntoId: params.adjuntoId,
        comentario: body.comentario,
        currentUser: {
          id: user.id,
          workflowOwnerId: user.workflowOwnerId,
          ...(user.isSystemAdmin ? { isSystemAdmin: true } : {}),
        },
        descripcion: body.descripcion,
        nroDocumento: body.nroDocumento,
        restringido: body.restringido,
        solicitudId: params.id,
        tipoAdjunto: body.tipoAdjunto,
        updatedBy: user.id,
        workflowOwnerId,
      });

      res.status(200).json(adjunto);
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
      const params = this.parseRequest<SolicitudAdjuntoByIdParams>(
        solicitudAdjuntoByIdParamsSchema,
        req.params,
      );
      const body = this.parseRequest<DeleteSolicitudAdjuntoBody>(
        deleteSolicitudAdjuntoBodySchema,
        req.body,
      );
      const adjunto = await this.deleteSolicitudAdjuntoUseCase.execute({
        adjuntoId: params.adjuntoId,
        currentUser: {
          id: user.id,
          workflowOwnerId: user.workflowOwnerId,
          ...(user.isSystemAdmin ? { isSystemAdmin: true } : {}),
        },
        deleteReason: body.deleteReason ?? body.comentario,
        deletedBy: user.id,
        solicitudId: params.id,
        workflowOwnerId,
      });

      res.status(200).json(adjunto);
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
      throw new InvalidSolicitudAdjuntoRequestError();
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
