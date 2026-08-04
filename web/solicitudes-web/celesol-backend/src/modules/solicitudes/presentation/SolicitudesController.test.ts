import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";

import type { GetCurrentUserUseCase } from "../../auth/application/use-cases/GetCurrentUser.use-case";
import { InvalidSessionError } from "../../auth/domain/auth-errors";
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
} from "../domain/solicitudes-errors";
import { SolicitudesController } from "./SolicitudesController";

function createController(getCurrentUserUseCase: GetCurrentUserUseCase) {
  const emptyUseCase = {
    execute: async () => [],
  };

  return new SolicitudesController({
    getCurrentUserUseCase,
    getLineasPrestamoUseCase:
      emptyUseCase as unknown as GetLineasPrestamoUseCase,
    getSocioMutualCancelacionDetalleUseCase:
      emptyUseCase as unknown as GetSocioMutualCancelacionDetalleUseCase,
    getSocioMutualUseCase: emptyUseCase as unknown as GetSocioMutualUseCase,
    getSolicitudDetalleUseCase:
      emptyUseCase as unknown as GetSolicitudDetalleUseCase,
    getSolicitudDetailByOidUseCase:
      emptyUseCase as unknown as GetSolicitudDetailByOidUseCase,
    getSolicitudesHistoricasUseCase:
      emptyUseCase as unknown as GetSolicitudesHistoricasUseCase,
    getSolicitudesPrecargaUseCase:
      emptyUseCase as unknown as GetSolicitudesPrecargaUseCase,
    getSolicitudesRecientesUseCase:
      emptyUseCase as unknown as GetSolicitudesRecientesUseCase,
    listSociosCancelacionesUseCase:
      emptyUseCase as unknown as ListSociosCancelacionesUseCase,
  });
}

describe("SolicitudesController", () => {
  it("returns invalid session errors before loading protected tables", async () => {
    const controller = createController({
      execute: async () => {
        throw new InvalidSessionError();
      },
    } as unknown as GetCurrentUserUseCase);
    const req = {
      cookies: {},
      query: {},
    } as unknown as Request;
    const res = {
      json: () => res,
      status: () => res,
    } as unknown as Response;
    let nextError: unknown = null;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.precarga(req, res, next);

    assert.ok(nextError instanceof InvalidSessionError);
  });

  it("returns invalid request errors for invalid solicitud detail oid", async () => {
    const controller = createController({
      execute: async () => ({
        legacyUser: "apajon",
        workflowOwnerId: "owner-1",
      }),
    } as unknown as GetCurrentUserUseCase);
    const req = {
      cookies: {},
      query: {
        oid: "not-a-number",
      },
    } as unknown as Request;
    const res = {
      json: () => res,
      status: () => res,
    } as unknown as Response;
    let nextError: unknown = null;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.detail(req, res, next);

    assert.ok(nextError instanceof InvalidSolicitudesRequestError);
  });

  it("returns controlled 403 when authenticated user has no workflow owner", async () => {
    const controller = createController({
      execute: async () => ({
        legacyUser: "apajon",
        state: 2,
        workflowOwnerId: null,
      }),
    } as unknown as GetCurrentUserUseCase);
    const req = {
      cookies: {},
      query: {},
    } as unknown as Request;
    const res = {
      json: () => res,
      status: () => res,
    } as unknown as Response;
    let nextError: unknown = null;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.precarga(req, res, next);

    assert.ok(nextError instanceof MissingWorkflowOwnerAssignmentError);
  });

  it("allows a system admin without a workflow owner to access protected tables", async () => {
    const controller = createController({
      execute: async () => ({
        isSystemAdmin: true,
        legacyUser: "apajon",
        workflowOwnerId: null,
      }),
    } as unknown as GetCurrentUserUseCase);
    const req = {
      cookies: {},
      query: {},
    } as unknown as Request;
    let jsonBody: unknown;
    const res = {
      json: (body: unknown) => {
        jsonBody = body;
        return res;
      },
      status: () => res,
    } as unknown as Response;
    let nextError: unknown = null;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.precarga(req, res, next);

    assert.equal(nextError, null);
    assert.deepEqual(jsonBody, []);
  });
});
