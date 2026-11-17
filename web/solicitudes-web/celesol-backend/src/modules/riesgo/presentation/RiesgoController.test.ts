import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Response } from "express";

import { InvalidSessionError } from "../../auth/domain/auth-errors";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import {
  CalculadoraVersionNotFoundError,
  ForbiddenCalculadoraAccessError,
  InvalidEvaluacionRequestError,
  InvalidSolicitudOidError,
} from "../domain/riesgo-errors";
import { leerPlanillaRepositorio } from "../infrastructure/services/PlanillaRepositorio";
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

  it("sirve la version vigente de la base en lugar del archivo", async () => {
    const contenido = Buffer.from("planilla-vigente");
    const controller = buildController({
      calculadoraVersiones: {
        findVigente: async () => ({ contenido }),
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
    assert.equal(response.body, contenido);
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

  it("rejects saving an evaluacion with an invalid body before calling the use case", async () => {
    let llamado = false;
    const controller = buildController({
      guardarEvaluacionRiesgoUseCase: {
        execute: async () => {
          llamado = true;
        },
      },
    });
    let nextError: unknown;

    await controller.guardarEvaluacion(
      {
        ...(request({
          solicitudId: "b3b3b3b3-1111-4222-8333-444444444444",
        }) as object),
        body: { nivelRiesgo: 9, snapshot: { sheets: {} } },
      } as never,
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof InvalidEvaluacionRequestError);
    assert.equal(llamado, false);
  });

  it("rejects saving an evaluacion for a vendedor", async () => {
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

    await controller.guardarEvaluacion(
      request({ solicitudId: "b3b3b3b3-1111-4222-8333-444444444444" }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof ForbiddenCalculadoraAccessError);
  });
});

describe("RiesgoController versiones de la calculadora", () => {
  const VENDEDOR = {
    getCurrentUserUseCase: {
      execute: async () => ({
        ...authenticatedUser(),
        workflowOwner: { code: "VENDEDORES", id: "o-v", name: "Vendedores" },
      }),
    },
  };
  const HUELLA = "a".repeat(64);
  const VERSION_ID = "00000000-0000-4000-8000-000000000001";

  async function llamar(
    accion:
      | "aplicarVersion"
      | "listarVersiones"
      | "previsualizarVersion"
      | "restaurarVersion",
    controller: RiesgoController,
    req: unknown,
  ) {
    const response = createResponse();
    let nextError: unknown;
    await controller[accion](
      req as never,
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );
    return { nextError, response };
  }

  for (const accion of [
    "aplicarVersion",
    "listarVersiones",
    "previsualizarVersion",
    "restaurarVersion",
  ] as const) {
    it(`${accion}: solo Riesgo o admin`, async () => {
      const { nextError } = await llamar(
        accion,
        buildController(VENDEDOR),
        { ...(request({ versionId: VERSION_ID }) as object), body: { huellaVimarx: HUELLA } },
      );
      assert.ok(nextError instanceof ForbiddenCalculadoraAccessError);
    });
  }

  it("aplica con la huella revisada y el usuario actual", async () => {
    const llamadas: unknown[] = [];
    const controller = buildController({
      calculadoraVersionesUseCase: {
        aplicar: async (input: unknown) => {
          llamadas.push(input);
          return { id: VERSION_ID };
        },
      },
    });

    const { nextError, response } = await llamar("aplicarVersion", controller, {
      ...(request() as object),
      body: { huellaVimarx: HUELLA },
    });

    assert.equal(nextError, undefined);
    assert.deepEqual(llamadas, [{ huellaVimarx: HUELLA, usuarioId: "user-1" }]);
    assert.deepEqual(response.body, { version: { id: VERSION_ID } });
  });

  it("no aplica sin una huella válida", async () => {
    const { nextError } = await llamar("aplicarVersion", buildController(), {
      ...(request() as object),
      body: { huellaVimarx: "cualquiera" },
    });
    assert.ok(nextError instanceof InvalidEvaluacionRequestError);
  });

  it("restaurar rechaza un id que no es uuid", async () => {
    const { nextError } = await llamar(
      "restaurarVersion",
      buildController(),
      request({ versionId: "../otra" }),
    );
    assert.ok(nextError instanceof CalculadoraVersionNotFoundError);
  });

  it("restaura la versión pedida con el usuario actual", async () => {
    const llamadas: unknown[] = [];
    const controller = buildController({
      calculadoraVersionesUseCase: {
        restaurar: async (input: unknown) => {
          llamadas.push(input);
          return { id: "nueva" };
        },
      },
    });

    const { nextError } = await llamar(
      "restaurarVersion",
      controller,
      request({ versionId: VERSION_ID }),
    );

    assert.equal(nextError, undefined);
    assert.deepEqual(llamadas, [{ usuarioId: "user-1", versionId: VERSION_ID }]);
  });
});

function buildController(
  overrides?: Partial<{
    calculadoraMutualDatosProvider: unknown;
    calculadoraVersiones: unknown;
    calculadoraVersionesUseCase: unknown;
    getCurrentUserUseCase: unknown;
    guardarEvaluacionRiesgoUseCase: unknown;
  }>,
) {
  return new RiesgoController({
    calculadoraMutualDatosProvider: ({
      getDatos: async () => ({}),
      getDatosByCoreId: async () => ({}),
      ...(overrides?.calculadoraMutualDatosProvider ?? {}),
    } as never),
    calculadoraVersiones: ({
      findVigente: async () => null,
      ...(overrides?.calculadoraVersiones ?? {}),
    } as never),
    calculadoraVersionesUseCase: ({
      aplicar: async () => null,
      listar: async () => [],
      previsualizar: async () => ({}),
      restaurar: async () => ({}),
      ...(overrides?.calculadoraVersionesUseCase ?? {}),
    } as never),
    leerPlanillaRepositorio,
    getCurrentUserUseCase: ({
      execute: async () => authenticatedUser(),
      ...(overrides?.getCurrentUserUseCase ?? {}),
    } as never),
    getEvaluacionRiesgoUseCase: {
      execute: async () => null,
    } as never,
    guardarEvaluacionRiesgoUseCase: ({
      execute: async () => ({}),
      ...(overrides?.guardarEvaluacionRiesgoUseCase ?? {}),
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
