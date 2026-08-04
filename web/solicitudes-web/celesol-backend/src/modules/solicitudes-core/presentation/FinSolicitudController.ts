import type { NextFunction, Request, Response } from "express";

import { InvalidSolicitudesCoreRequestError } from "../domain/solicitudes-core-errors";
import type { GetFinSolicitudDatosUseCase } from "../application/use-cases/GetFinSolicitudDatos.use-case";
import {
  finSolicitudParamsSchema,
  type FinSolicitudParams,
} from "./SolicitudesCoreRequest.schema";

type Dependencies = {
  getFinSolicitudDatosUseCase: GetFinSolicitudDatosUseCase;
};

// Endpoint publico, sin autenticacion -- replica el contrato de
// POST /api/redunisol/finSolicitud/:ntrans/:sol (ver
// finalizar-api-caja-celesol-contrato.txt). No debe depender de
// getCurrentUserUseCase ni de ninguna cookie de sesion.
// "sol" acepta nuestro uuid interno o el legacyOid de Vimax, ver
// GetFinSolicitudDatos.use-case.ts.
export class FinSolicitudController {
  private readonly getFinSolicitudDatosUseCase: GetFinSolicitudDatosUseCase;

  constructor(dependencies: Dependencies) {
    this.getFinSolicitudDatosUseCase = dependencies.getFinSolicitudDatosUseCase;
  }

  finSolicitud = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = this.parseParams(req.params);
      const datos = await this.getFinSolicitudDatosUseCase.execute({
        sol: params.sol,
      });

      res.status(200).json(datos);
    } catch (error) {
      next(error);
    }
  };

  private parseParams(params: unknown): FinSolicitudParams {
    const parsed = finSolicitudParamsSchema.safeParse(params);

    if (!parsed.success) {
      throw new InvalidSolicitudesCoreRequestError();
    }

    return parsed.data;
  }
}
