import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Response } from "express";

import { InvalidSessionError } from "../../auth/domain/auth-errors";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import {
  ForbiddenSocioCreationError,
  ForbiddenSocioDeleteError,
  ForbiddenSocioUpdateError,
  InvalidSocioRequestError,
} from "../domain/socios-errors";
import { SociosController } from "./SociosController";

const SOCIO_ID = "11111111-1111-4111-8111-111111111111";
const SOCIO_JURIDICA_ID = "22222222-2222-4222-8222-222222222222";

describe("SociosController", () => {
  it("creates a socio and returns 201", async () => {
    const controller = buildController({
      createSocioUseCase: {
        execute: async () => buildFisicaSocio(),
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.create(
      request({
        body: {
          apellido: "Perez",
          cuit: "20-12345678-3",
          domicilioCalle: "San Martin",
          domicilioCodigoPostal: "2300",
          domicilioLocalidad: "12",
          domicilioNroPuerta: "742",
          fechaDeNacimiento: "1990-02-28",
          nombre: "Juan",
          nroDocumento: "12345678",
          sexo: "M",
          tipoDocumento: "DNI",
          tipoPersona: "FISICA",
        },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.body, {
      apellido: "Perez",
      celular: null,
      createdAt: "2026-06-19T18:00:00.000Z",
      cuit: "20123456783",
      domicilioCalle: null,
      domicilioCodigoPostal: null,
      domicilioLocalidad: null,
      domicilioNroPuerta: null,
      email: null,
      fechaDeNacimiento: "1990-02-28",
      id: SOCIO_ID,
      nombre: "Juan",
      nroDocumento: "12345678",
      nroSocioLegacy: null,
      sexo: "M",
      tipoDocumento: "DNI",
      tipoPersona: "FISICA",
      updatedAt: "2026-06-19T18:00:00.000Z",
    });
  });

  it("rejects socio creation for a vendedor (non-RIESGO, non-admin)", async () => {
    let useCaseCalled = false;
    const controller = buildController({
      createSocioUseCase: {
        execute: async () => {
          useCaseCalled = true;

          return buildFisicaSocio();
        },
      },
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

    await controller.create(
      request({
        body: {
          apellido: "Perez",
          cuit: "20-12345678-3",
          domicilioCalle: "San Martin",
          domicilioCodigoPostal: "2300",
          domicilioLocalidad: "12",
          domicilioNroPuerta: "742",
          fechaDeNacimiento: "1990-02-28",
          nombre: "Juan",
          nroDocumento: "12345678",
          sexo: "M",
          tipoDocumento: "DNI",
          tipoPersona: "FISICA",
        },
      }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(useCaseCalled, false);
    assert.ok(nextError instanceof ForbiddenSocioCreationError);
  });

  it("rejects socio creation for a user without a workflow owner", async () => {
    let useCaseCalled = false;
    const controller = buildController({
      createSocioUseCase: {
        execute: async () => {
          useCaseCalled = true;

          return buildFisicaSocio();
        },
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          ...authenticatedUser(),
          workflowOwner: null,
          workflowOwnerId: null,
        }),
      },
    });
    let nextError: unknown;

    await controller.create(
      request({
        body: {
          apellido: "Perez",
          cuit: "20-12345678-3",
          domicilioCalle: "San Martin",
          domicilioCodigoPostal: "2300",
          domicilioLocalidad: "12",
          domicilioNroPuerta: "742",
          fechaDeNacimiento: "1990-02-28",
          nombre: "Juan",
          nroDocumento: "12345678",
          sexo: "M",
          tipoDocumento: "DNI",
          tipoPersona: "FISICA",
        },
      }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(useCaseCalled, false);
    assert.ok(nextError instanceof ForbiddenSocioCreationError);
  });

  it("allows socio creation for a system admin regardless of workflow owner", async () => {
    let receivedInput: unknown;
    const controller = buildController({
      createSocioUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return buildFisicaSocio();
        },
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          ...authenticatedUser(),
          isSystemAdmin: true,
          workflowOwner: null,
          workflowOwnerId: null,
        }),
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.create(
      request({
        body: {
          apellido: "Perez",
          cuit: "20-12345678-3",
          domicilioCalle: "San Martin",
          domicilioCodigoPostal: "2300",
          domicilioLocalidad: "12",
          domicilioNroPuerta: "742",
          fechaDeNacimiento: "1990-02-28",
          nombre: "Juan",
          nroDocumento: "12345678",
          sexo: "M",
          tipoDocumento: "DNI",
          tipoPersona: "FISICA",
        },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 201);
    assert.notEqual(receivedInput, undefined);
  });

  it("lists socios and maps persona juridica without physical null fields", async () => {
    const controller = buildController({
      listSociosUseCase: {
        execute: async () => ({
          items: [buildJuridicaSocio()],
          total: 1,
        }),
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.list(
      request(),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      items: [
        {
          celular: null,
          createdAt: "2026-06-19T18:00:00.000Z",
          cuit: "30123456789",
          domicilioCalle: null,
          domicilioCodigoPostal: null,
          domicilioLocalidad: null,
          domicilioNroPuerta: null,
          email: null,
          id: SOCIO_JURIDICA_ID,
          nroSocioLegacy: null,
          razonSocial: "ACME SA",
          tipoPersona: "JURIDICA",
          updatedAt: "2026-06-19T18:00:00.000Z",
        },
      ],
      total: 1,
    });
  });

  it("gets one socio by id", async () => {
    const controller = buildController({
      getSocioByIdUseCase: {
        execute: async () => buildFisicaSocio(),
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.getById(
      request({ params: { id: SOCIO_ID } }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.equal((response.body as { id: string }).id, SOCIO_ID);
  });

  it("looks up a physical socio by documento", async () => {
    const controller = buildController({
      lookupSocioByDocumentoUseCase: {
        execute: async () => ({
          match: "single",
          socio: buildFisicaSocio(),
        }),
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.lookup(
      request({
        query: {
          documento: "12345678",
          tipoDocumento: "DNI",
        },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      match: "single",
      socio: {
        apellido: "Perez",
        celular: null,
        createdAt: "2026-06-19T18:00:00.000Z",
        cuit: "20123456783",
        domicilioCalle: null,
        domicilioCodigoPostal: null,
        domicilioLocalidad: null,
        domicilioNroPuerta: null,
        email: null,
        fechaDeNacimiento: "1990-02-28",
        id: SOCIO_ID,
        nombre: "Juan",
        nroDocumento: "12345678",
        nroSocioLegacy: null,
        sexo: "M",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
        updatedAt: "2026-06-19T18:00:00.000Z",
      },
    });
  });

  it("looks up a juridica socio by cuit", async () => {
    const controller = buildController({
      lookupSocioByDocumentoUseCase: {
        execute: async () => ({
          match: "single",
          socio: buildJuridicaSocio(),
        }),
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.lookup(
      request({
        query: {
          documento: "30123456789",
        },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      match: "single",
      socio: {
        celular: null,
        createdAt: "2026-06-19T18:00:00.000Z",
        cuit: "30123456789",
        domicilioCalle: null,
        domicilioCodigoPostal: null,
        domicilioLocalidad: null,
        domicilioNroPuerta: null,
        email: null,
        id: SOCIO_JURIDICA_ID,
        nroSocioLegacy: null,
        razonSocial: "ACME SA",
        tipoPersona: "JURIDICA",
        updatedAt: "2026-06-19T18:00:00.000Z",
      },
    });
  });

  it("returns none on lookup when there is no match", async () => {
    const controller = buildController({
      lookupSocioByDocumentoUseCase: {
        execute: async () => ({
          match: "none",
        }),
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.lookup(
      request({
        query: {
          documento: "99999999",
        },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      match: "none",
    });
  });

  it("checks cuit availability and returns exists:true on a match", async () => {
    const controller = buildController({
      checkSocioCuitDuplicateUseCase: {
        execute: async () => ({ exists: true }),
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.checkCuit(
      request({
        query: { cuit: "20123456783" },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { exists: true });
  });

  it("checks cuit availability excluding the socio being edited", async () => {
    let receivedExcludeSocioId: string | undefined;
    const controller = buildController({
      checkSocioCuitDuplicateUseCase: {
        execute: async ({ excludeSocioId }: { excludeSocioId?: string }) => {
          receivedExcludeSocioId = excludeSocioId;

          return { exists: false };
        },
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.checkCuit(
      request({
        query: { cuit: "20123456783", excludeSocioId: SOCIO_ID },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { exists: false });
    assert.equal(receivedExcludeSocioId, SOCIO_ID);
  });

  it("checks documento availability and returns exists:true on a match", async () => {
    const controller = buildController({
      checkSocioDocumentoDuplicateUseCase: {
        execute: async () => ({ exists: true }),
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.checkDocumento(
      request({
        query: { nroDocumento: "12345678" },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { exists: true });
  });

  it("checks documento availability excluding the socio being edited", async () => {
    let receivedExcludeSocioId: string | undefined;
    const controller = buildController({
      checkSocioDocumentoDuplicateUseCase: {
        execute: async ({ excludeSocioId }: { excludeSocioId?: string }) => {
          receivedExcludeSocioId = excludeSocioId;

          return { exists: false };
        },
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.checkDocumento(
      request({
        query: { excludeSocioId: SOCIO_ID, nroDocumento: "12345678" },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { exists: false });
    assert.equal(receivedExcludeSocioId, SOCIO_ID);
  });

  it("updates one socio", async () => {
    const controller = buildController({
      updateSocioUseCase: {
        execute: async () => buildJuridicaSocio(),
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.update(
      request({
        body: {
          razonSocial: "ACME SA",
        },
        params: { id: SOCIO_JURIDICA_ID },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.equal(
      (response.body as { tipoPersona: string }).tipoPersona,
      "JURIDICA",
    );
  });

  it("rejects socio update for a vendedor (non-RIESGO, non-admin)", async () => {
    let useCaseCalled = false;
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
      updateSocioUseCase: {
        execute: async () => {
          useCaseCalled = true;

          return buildJuridicaSocio();
        },
      },
    });
    let nextError: unknown;

    await controller.update(
      request({
        body: { razonSocial: "ACME SA" },
        params: { id: SOCIO_JURIDICA_ID },
      }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(useCaseCalled, false);
    assert.ok(nextError instanceof ForbiddenSocioUpdateError);
  });

  it("rejects socio deletion for a vendedor (non-RIESGO, non-admin)", async () => {
    let useCaseCalled = false;
    const controller = buildController({
      deleteSocioUseCase: {
        execute: async () => {
          useCaseCalled = true;
        },
      },
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

    await controller.delete(
      request({ params: { id: SOCIO_ID } }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(useCaseCalled, false);
    assert.ok(nextError instanceof ForbiddenSocioDeleteError);
  });

  it("deletes one socio and returns 204", async () => {
    const controller = buildController();
    const response = createResponse();
    let nextError: unknown;

    await controller.delete(
      request({ params: { id: SOCIO_ID } }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 204);
    assert.equal(response.sent, true);
  });

  it("rejects malformed create bodies", async () => {
    const controller = buildController();
    let nextError: unknown;

    await controller.create(
      request({
        body: {
          cuit: "20-12345678-3",
          tipoPersona: "FISICA",
        },
      }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof InvalidSocioRequestError);
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

    await controller.list(
      request(),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof InvalidSessionError);
  });
});

function buildController(
  overrides?: Partial<{
    checkSocioCuitDuplicateUseCase: unknown;
    checkSocioDocumentoDuplicateUseCase: unknown;
    createSocioUseCase: unknown;
    deleteSocioUseCase: unknown;
    getCurrentUserUseCase: unknown;
    getSocioByIdUseCase: unknown;
    listSociosUseCase: unknown;
    lookupSocioByDocumentoUseCase: unknown;
    updateSocioUseCase: unknown;
  }>,
) {
  return new SociosController({
    checkSocioCuitDuplicateUseCase: ({
      execute: async () => ({ exists: false }),
      ...(overrides?.checkSocioCuitDuplicateUseCase ?? {}),
    } as never),
    checkSocioDocumentoDuplicateUseCase: ({
      execute: async () => ({ exists: false }),
      ...(overrides?.checkSocioDocumentoDuplicateUseCase ?? {}),
    } as never),
    createSocioUseCase: ({
      execute: async () => buildFisicaSocio(),
      ...(overrides?.createSocioUseCase ?? {}),
    } as never),
    deleteSocioUseCase: ({
      execute: async () => undefined,
      ...(overrides?.deleteSocioUseCase ?? {}),
    } as never),
    getCurrentUserUseCase: ({
      execute: async () => authenticatedUser(),
      ...(overrides?.getCurrentUserUseCase ?? {}),
    } as never),
    getSocioByIdUseCase: ({
      execute: async () => buildFisicaSocio(),
      ...(overrides?.getSocioByIdUseCase ?? {}),
    } as never),
    listSociosUseCase: ({
      execute: async () => ({
        items: [buildFisicaSocio(), buildJuridicaSocio()],
        total: 2,
      }),
      ...(overrides?.listSociosUseCase ?? {}),
    } as never),
    lookupSocioByDocumentoUseCase: ({
      execute: async () => ({
        match: "none",
      }),
      ...(overrides?.lookupSocioByDocumentoUseCase ?? {}),
    } as never),
    updateSocioUseCase: ({
      execute: async () => buildFisicaSocio(),
      ...(overrides?.updateSocioUseCase ?? {}),
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

function buildFisicaSocio() {
  return {
    apellido: "Perez",
    celular: null,
    createdAt: new Date("2026-06-19T18:00:00.000Z"),
    cuit: "20123456783",
    domicilioCalle: null,
    domicilioCodigoPostal: null,
    domicilioLocalidad: null,
    domicilioNroPuerta: null,
    email: null,
    fechaDeNacimiento: new Date("1990-02-28T00:00:00.000Z"),
    id: SOCIO_ID,
    nombre: "Juan",
    nroDocumento: "12345678",
    nroSocioLegacy: null,
    razonSocial: null,
    sexo: "M",
    tipoDocumento: "DNI",
    tipoPersona: "FISICA" as const,
    updatedAt: new Date("2026-06-19T18:00:00.000Z"),
  };
}

function buildJuridicaSocio() {
  return {
    apellido: null,
    celular: null,
    createdAt: new Date("2026-06-19T18:00:00.000Z"),
    cuit: "30123456789",
    domicilioCalle: null,
    domicilioCodigoPostal: null,
    domicilioLocalidad: null,
    domicilioNroPuerta: null,
    email: null,
    fechaDeNacimiento: null,
    id: SOCIO_JURIDICA_ID,
    nombre: null,
    nroDocumento: null,
    nroSocioLegacy: null,
    razonSocial: "ACME SA",
    sexo: null,
    tipoDocumento: null,
    tipoPersona: "JURIDICA" as const,
    updatedAt: new Date("2026-06-19T18:00:00.000Z"),
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
    sent: false,
    statusCode: 0,
    json(payload: unknown) {
      response.body = payload;
      return response;
    },
    send() {
      response.sent = true;
      return response;
    },
    status(code: number) {
      response.statusCode = code;
      return response;
    },
  };

  return response as unknown as Response & {
    body: unknown;
    sent: boolean;
    statusCode: number;
  };
}

function request(input?: {
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
}) {
  return {
    body: input?.body ?? {},
    cookies: {
      [ACCESS_TOKEN_COOKIE]: "token",
    },
    params: input?.params ?? {},
    query: input?.query ?? {},
  } as never;
}
