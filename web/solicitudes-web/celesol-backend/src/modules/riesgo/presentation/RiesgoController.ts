import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import type { GetCurrentUserUseCase } from "../../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import type { CalculadoraMutualDatosProvider } from "../application/services/CalculadoraMutualDatosProvider";
import type { GetEvaluacionRiesgoUseCase } from "../application/use-cases/GetEvaluacionRiesgo.use-case";
import type { GuardarEvaluacionRiesgoUseCase } from "../application/use-cases/GuardarEvaluacionRiesgo.use-case";
import {
  CalculadoraFileNotFoundError,
  ForbiddenCalculadoraAccessError,
  InvalidEvaluacionRequestError,
  InvalidSolicitudOidError,
} from "../domain/riesgo-errors";

const CALCULADORA_FILE_PATH = path.join(
  process.cwd(),
  "docs",
  "calculadora-riesgo",
  "CALCULADORA MUTUAL.xlsx",
);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CookieRequest = Request & {
  cookies?: Record<string, string | undefined>;
};

// El snapshot es el IWorkbookData de Univer: se guarda tal cual, solo se
// exige que sea un objeto con hojas.
const guardarEvaluacionBodySchema = z.object({
  nivelRiesgo: z.number().int().min(1).max(5).nullable(),
  snapshot: z
    .object({ sheets: z.record(z.string(), z.unknown()) })
    .passthrough(),
});

type Dependencies = {
  calculadoraMutualDatosProvider: CalculadoraMutualDatosProvider;
  getCurrentUserUseCase: GetCurrentUserUseCase;
  getEvaluacionRiesgoUseCase: GetEvaluacionRiesgoUseCase;
  guardarEvaluacionRiesgoUseCase: GuardarEvaluacionRiesgoUseCase;
};

export class RiesgoController {
  private readonly calculadoraMutualDatosProvider: CalculadoraMutualDatosProvider;
  private readonly getCurrentUserUseCase: GetCurrentUserUseCase;
  private readonly getEvaluacionRiesgoUseCase: GetEvaluacionRiesgoUseCase;
  private readonly guardarEvaluacionRiesgoUseCase: GuardarEvaluacionRiesgoUseCase;

  constructor(dependencies: Dependencies) {
    this.calculadoraMutualDatosProvider =
      dependencies.calculadoraMutualDatosProvider;
    this.getCurrentUserUseCase = dependencies.getCurrentUserUseCase;
    this.getEvaluacionRiesgoUseCase = dependencies.getEvaluacionRiesgoUseCase;
    this.guardarEvaluacionRiesgoUseCase =
      dependencies.guardarEvaluacionRiesgoUseCase;
  }

  // La evaluacion guardada de la solicitud, o null si todavia no se guardo.
  getEvaluacion = async (
    req: CookieRequest & { params: { solicitudId?: string } },
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await this.assertRiesgoAccess(req);

      const evaluacion = await this.getEvaluacionRiesgoUseCase.execute({
        solicitudId: this.requireSolicitudId(req.params.solicitudId),
      });

      res.status(200).json({ evaluacion });
    } catch (error) {
      next(error);
    }
  };

  guardarEvaluacion = async (
    req: CookieRequest & { params: { solicitudId?: string } },
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const currentUser = await this.assertRiesgoAccess(req);
      const solicitudId = this.requireSolicitudId(req.params.solicitudId);
      const body = guardarEvaluacionBodySchema.safeParse(req.body);

      if (!body.success) {
        throw new InvalidEvaluacionRequestError();
      }

      const resultado = await this.guardarEvaluacionRiesgoUseCase.execute({
        currentUser: {
          id: currentUser.id,
          isSystemAdmin: currentUser.isSystemAdmin,
          workflowOwnerCode: currentUser.workflowOwner?.code ?? null,
          workflowOwnerId: currentUser.workflowOwnerId,
        },
        nivelRiesgo: body.data.nivelRiesgo,
        snapshot: body.data.snapshot,
        solicitudId,
      });

      res.status(200).json(resultado);
    } catch (error) {
      next(error);
    }
  };

  getCalculadora = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await this.assertRiesgoAccess(req);

      let fileBuffer: Buffer;

      try {
        fileBuffer = await readFile(CALCULADORA_FILE_PATH);
      } catch {
        throw new CalculadoraFileNotFoundError();
      }

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.status(200).send(fileBuffer);
    } catch (error) {
      next(error);
    }
  };

  getCalculadoraDatos = async (
    req: CookieRequest & { params: { oid?: string } },
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await this.assertRiesgoAccess(req);

      const oid = req.params.oid;

      if (!oid || !/^\d+$/.test(oid)) {
        throw new InvalidSolicitudOidError();
      }

      const datos = await this.calculadoraMutualDatosProvider.getDatos(oid);

      res.status(200).json(datos);
    } catch (error) {
      next(error);
    }
  };

  getCalculadoraDatosByCoreId = async (
    req: CookieRequest & { params: { solicitudId?: string } },
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await this.assertRiesgoAccess(req);

      const solicitudId = req.params.solicitudId;

      if (!solicitudId || !UUID_PATTERN.test(solicitudId)) {
        throw new InvalidSolicitudOidError();
      }

      const datos =
        await this.calculadoraMutualDatosProvider.getDatosByCoreId(
          solicitudId,
        );

      res.status(200).json(datos);
    } catch (error) {
      next(error);
    }
  };

  private async assertRiesgoAccess(req: CookieRequest) {
    const currentUser = await this.getCurrentUser(req);

    if (
      !currentUser.isSystemAdmin &&
      currentUser.workflowOwner?.code !== "RIESGO"
    ) {
      throw new ForbiddenCalculadoraAccessError();
    }

    return currentUser;
  }

  private requireSolicitudId(solicitudId: string | undefined) {
    if (!solicitudId || !UUID_PATTERN.test(solicitudId)) {
      throw new InvalidSolicitudOidError();
    }

    return solicitudId;
  }

  private getCurrentUser(req: CookieRequest) {
    return this.getCurrentUserUseCase.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
  }
}
