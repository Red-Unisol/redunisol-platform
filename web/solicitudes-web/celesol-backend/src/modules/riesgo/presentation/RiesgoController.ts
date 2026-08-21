import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";

import type { GetCurrentUserUseCase } from "../../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import type { CalculadoraMutualDatosProvider } from "../application/services/CalculadoraMutualDatosProvider";
import {
  CalculadoraFileNotFoundError,
  ForbiddenCalculadoraAccessError,
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

type Dependencies = {
  calculadoraMutualDatosProvider: CalculadoraMutualDatosProvider;
  getCurrentUserUseCase: GetCurrentUserUseCase;
};

export class RiesgoController {
  private readonly calculadoraMutualDatosProvider: CalculadoraMutualDatosProvider;
  private readonly getCurrentUserUseCase: GetCurrentUserUseCase;

  constructor(dependencies: Dependencies) {
    this.calculadoraMutualDatosProvider =
      dependencies.calculadoraMutualDatosProvider;
    this.getCurrentUserUseCase = dependencies.getCurrentUserUseCase;
  }

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
  }

  private getCurrentUser(req: CookieRequest) {
    return this.getCurrentUserUseCase.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
  }
}
