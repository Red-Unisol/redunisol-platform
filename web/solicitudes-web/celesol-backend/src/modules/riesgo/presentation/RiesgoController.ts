import { hasWorkflowArea } from "../../auth/domain/workflow-areas";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import type { GetCurrentUserUseCase } from "../../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import type { CalculadoraMutualDatosProvider } from "../application/services/CalculadoraMutualDatosProvider";
import type { CalculadoraVersionesUseCase } from "../application/use-cases/CalculadoraVersiones.use-case";
import type { CalculadoraRiesgoVersionRepository } from "../domain/repositories/CalculadoraRiesgoVersionRepository";
import type { GetEvaluacionRiesgoUseCase } from "../application/use-cases/GetEvaluacionRiesgo.use-case";
import type { GuardarEvaluacionRiesgoUseCase } from "../application/use-cases/GuardarEvaluacionRiesgo.use-case";
import {
  CalculadoraVersionNotFoundError,
  ForbiddenCalculadoraAccessError,
  InvalidEvaluacionRequestError,
  InvalidSolicitudOidError,
} from "../domain/riesgo-errors";

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

const aplicarVersionBodySchema = z.object({
  huellaVimarx: z.string().regex(/^[0-9a-f]{64}$/),
});

type Dependencies = {
  calculadoraMutualDatosProvider: CalculadoraMutualDatosProvider;
  calculadoraVersiones: Pick<CalculadoraRiesgoVersionRepository, "findVigente">;
  calculadoraVersionesUseCase: Pick<
    CalculadoraVersionesUseCase,
    "aplicar" | "listar" | "previsualizar" | "restaurar"
  >;
  getCurrentUserUseCase: GetCurrentUserUseCase;
  getEvaluacionRiesgoUseCase: GetEvaluacionRiesgoUseCase;
  guardarEvaluacionRiesgoUseCase: GuardarEvaluacionRiesgoUseCase;
  leerPlanillaRepositorio: () => Promise<Buffer>;
};

export class RiesgoController {
  private readonly calculadoraMutualDatosProvider: CalculadoraMutualDatosProvider;
  private readonly calculadoraVersiones: Dependencies["calculadoraVersiones"];
  private readonly calculadoraVersionesUseCase: Dependencies["calculadoraVersionesUseCase"];
  private readonly leerPlanillaRepositorio: Dependencies["leerPlanillaRepositorio"];
  private readonly getCurrentUserUseCase: GetCurrentUserUseCase;
  private readonly getEvaluacionRiesgoUseCase: GetEvaluacionRiesgoUseCase;
  private readonly guardarEvaluacionRiesgoUseCase: GuardarEvaluacionRiesgoUseCase;

  constructor(dependencies: Dependencies) {
    this.calculadoraMutualDatosProvider =
      dependencies.calculadoraMutualDatosProvider;
    this.calculadoraVersiones = dependencies.calculadoraVersiones;
    this.calculadoraVersionesUseCase = dependencies.calculadoraVersionesUseCase;
    this.leerPlanillaRepositorio = dependencies.leerPlanillaRepositorio;
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
          workflowOwners: currentUser.workflowOwners,
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

      // La version que Riesgo trajo de Vimarx; si todavia no hay ninguna,
      // la planilla del repo.
      const vigente = await this.calculadoraVersiones.findVigente();
      const fileBuffer =
        vigente?.contenido ?? (await this.leerPlanillaRepositorio());

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.status(200).send(fileBuffer);
    } catch (error) {
      next(error);
    }
  };

  // Versiones de la calculadora: historial, vista previa de la ultima de
  // Vimarx, aplicarla y volver a una anterior.
  listarVersiones = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await this.assertRiesgoAccess(req);
      const versiones = await this.calculadoraVersionesUseCase.listar();
      res.status(200).json({ versiones });
    } catch (error) {
      next(error);
    }
  };

  previsualizarVersion = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await this.assertRiesgoAccess(req);
      const vistaPrevia = await this.calculadoraVersionesUseCase.previsualizar();
      res.status(200).json(vistaPrevia);
    } catch (error) {
      next(error);
    }
  };

  aplicarVersion = async (
    req: CookieRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const currentUser = await this.assertRiesgoAccess(req);
      const body = aplicarVersionBodySchema.safeParse(req.body);

      if (!body.success) {
        throw new InvalidEvaluacionRequestError();
      }

      const version = await this.calculadoraVersionesUseCase.aplicar({
        huellaVimarx: body.data.huellaVimarx,
        usuarioId: currentUser.id,
      });
      res.status(200).json({ version });
    } catch (error) {
      next(error);
    }
  };

  restaurarVersion = async (
    req: CookieRequest & { params: { versionId?: string } },
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const currentUser = await this.assertRiesgoAccess(req);
      const versionId = req.params.versionId;

      if (!versionId || !UUID_PATTERN.test(versionId)) {
        throw new CalculadoraVersionNotFoundError();
      }

      const version = await this.calculadoraVersionesUseCase.restaurar({
        usuarioId: currentUser.id,
        versionId,
      });
      res.status(200).json({ version });
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
      !hasWorkflowArea(currentUser, "RIESGO")
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
