import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Response } from "express";

import { InvalidSessionError } from "../../auth/domain/auth-errors";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import {
  ForbiddenCalculadoraAccessError,
  InvalidSolicitudOidError,
} from "../domain/riesgo-errors";
import { RiesgoController } from "./RiesgoController";

describe("RiesgoController", () => {
  it("returns the calculadora file for a system admin", async () => {
    const controller = buildController({
      getCurrentUserUseCase: {
        execute: async () => ({ ...authenticatedUser(), isSystemAdmin: true }),
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.getCalculadora(
      request(),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.equal(
      response.headers["Content-Type"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    assert.ok(Buffer.isBuffer(response.body));
    assert.ok((response.body as Buffer).length > 0);
  });

  it("returns the calculadora file for a RIESGO workflow owner", async () => {
    const controller = buildController();
    const response = createResponse();
    let nextError: unknown;

    await controller.getCalculadora(
      request(),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
  });

  it("rejects access for a vendedor (non-admin, non-RIESGO)", async () => {
    const controller = buildController({
      getCurrentUserUseCase: {
        execute: async () => ({
          ...authenticatedUser(),
          workflowOwner: {
            code: "VENDEDORES",
            id: "owner-vendedores",
            name: "Vendedores",
          },
        }),
      },
    });
    let nextError: unknown;

    await controller.getCalculadora(
      request(),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof ForbiddenCalculadoraAccessError);
  });

  it("passes unauthenticated errors through next", async () => {
    const controller = buildController({
      getCurrentUserUseCase: {
        execute: async () => {
          throw new InvalidSessionError();
        },
      },
    });
    let nextError: unknown;

    await controller.getCalculadora(
      request(),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof InvalidSessionError);
  });

  it("returns calculadora datos for a valid oid", async () => {
    const controller = buildController({
      calculadoraMutualDatosProvider: {
        getDatos: async (oid: string) => ({ nroSolicitud: oid }),
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.getCalculadoraDatos(
      request({ oid: "220844" }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { nroSolicitud: "220844" });
  });

  it("rejects a non-numeric oid before calling the gateway", async () => {
    const controller = buildController({
      calculadoraMutualDatosProvider: {
        getDatos: async () => {
          throw new Error("should not be called");
        },
      },
    });
    let nextError: unknown;

    await controller.getCalculadoraDatos(
      request({ oid: "not-a-number" }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof InvalidSolicitudOidError);
  });

  it("rejects calculadora datos access for a vendedor", async () => {
    const controller = buildController({
      getCurrentUserUseCase: {
        execute: async () => ({
          ...authenticatedUser(),
          workflowOwner: {
            code: "VENDEDORES",
            id: "owner-vendedores",
            name: "Vendedores",
          },
        }),
      },
    });
    let nextError: unknown;

    await controller.getCalculadoraDatos(
      request({ oid: "220844" }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof ForbiddenCalculadoraAccessError);
  });

  it("returns calculadora datos for a valid core solicitud id", async () => {
    const controller = buildController({
      calculadoraMutualDatosProvider: {
        getDatosByCoreId: async (id: string) => ({ nroSolicitud: id }),
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.getCalculadoraDatosByCoreId(
      request({ solicitudId: "b3b3b3b3-1111-4222-8333-444444444444" }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      nroSolicitud: "b3b3b3b3-1111-4222-8333-444444444444",
    });
  });

  it("rejects a non-uuid solicitudId before calling the provider", async () => {
    const controller = buildController({
      calculadoraMutualDatosProvider: {
        getDatosByCoreId: async () => {
          throw new Error("should not be called");
        },
      },
    });
    let nextError: unknown;

    await controller.getCalculadoraDatosByCoreId(
      request({ solicitudId: "not-a-uuid" }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof InvalidSolicitudOidError);
  });

  it("rejects calculadora datos by core id access for a vendedor", async () => {
    const controller = buildController({
      getCurrentUserUseCase: {
        execute: async () => ({
          ...authenticatedUser(),
          workflowOwner: {
            code: "VENDEDORES",
            id: "owner-vendedores",
            name: "Vendedores",
          },
        }),
      },
    });
    let nextError: unknown;

    await controller.getCalculadoraDatosByCoreId(
      request({ solicitudId: "b3b3b3b3-1111-4222-8333-444444444444" }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof ForbiddenCalculadoraAccessError);
  });
});

function buildController(
  overrides?: Partial<{
    calculadoraMutualDatosProvider: unknown;
    getCurrentUserUseCase: unknown;
  }>,
) {
  return new RiesgoController({
    calculadoraMutualDatosProvider: ({
      getDatos: async () => ({}),
      getDatosByCoreId: async () => ({}),
      ...(overrides?.calculadoraMutualDatosProvider ?? {}),
    } as never),
    getCurrentUserUseCase: ({
      execute: async () => authenticatedUser(),
      ...(overrides?.getCurrentUserUseCase ?? {}),
    } as never),
  } as never);
}

function authenticatedUser() {
  return {
    email: "user@example.com",
    emailVerified: true,
    firstName: "User",
    id: "user-1",
    isSystemAdmin: false,
    lastName: "Test",
    legacyUser: "USER1",
    state: 1,
    workflowOwner: {
      code: "RIESGO",
      id: "owner-1",
      name: "Riesgo",
    },
    workflowOwnerId: "owner-1",
  };
}

function captureNextError(onError: (error: unknown) => void): NextFunction {
  return (error?: unknown) => {
    onError(error);
  };
}

function createResponse() {
  const response = {
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    sent: false,
    statusCode: 0,
    json(payload: unknown) {
      response.body = payload;
      return response;
    },
    send(payload: unknown) {
      response.body = payload;
      response.sent = true;
      return response;
    },
    setHeader(name: string, value: string) {
      response.headers[name] = value;
      return response;
    },
    status(code: number) {
      response.statusCode = code;
      return response;
    },
  };

  return response as unknown as Response & {
    body: unknown;
    headers: Record<string, string>;
    sent: boolean;
    statusCode: number;
  };
}

function request(params: Record<string, string> = {}) {
  return {
    body: {},
    cookies: {
      [ACCESS_TOKEN_COOKIE]: "token",
    },
    params,
    query: {},
  } as never;
}
