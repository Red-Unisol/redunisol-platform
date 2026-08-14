import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Response } from "express";

import { SolicitudCancelacionesController } from "./SolicitudCancelacionesController";

function createResponse() {
  let responseBody: unknown;
  let statusCode = 0;
  const response = {
    json(payload: unknown) {
      responseBody = payload;

      return this;
    },
    status(code: number) {
      statusCode = code;

      return this;
    },
  } as unknown as Response;

  return {
    getBody: () => responseBody,
    getStatus: () => statusCode,
    response,
  };
}

describe("SolicitudCancelacionesController", () => {
  it("passes current user without requiring workflow owner when listing cancelaciones", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudCancelacionesController({
      createSolicitudCancelacionUseCase: {} as never,
      deleteSolicitudCancelacionUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "pending@example.com",
          emailVerified: true,
          firstName: "Pending",
          id: "user-1",
          lastName: "User",
          legacyUser: "PUSER",
          state: 2,
          workflowOwnerId: null,
        }),
      } as never,
      listSolicitudCancelacionesUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return [];
        },
      } as never,
      updateSolicitudCancelacionUseCase: {} as never,
    });
    const { getBody, getStatus, response } = createResponse();
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.list(
      {
        cookies: { accessToken: "token" },
        params: { id: "11111111-1111-4111-8111-111111111111" },
      } as never,
      response,
      next,
    );

    assert.equal(nextError, undefined);
    assert.equal(getStatus(), 200);
    assert.deepEqual(getBody(), []);
    assert.deepEqual(receivedInput, {
      currentUser: {
        id: "user-1",
        workflowOwnerId: null,
      },
      solicitudId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("bypasses the workflow owner requirement and forwards isSystemAdmin when creating a cancelacion", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudCancelacionesController({
      createSolicitudCancelacionUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return { id: "canc-1" };
        },
      } as never,
      deleteSolicitudCancelacionUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "admin@example.com",
          emailVerified: true,
          firstName: "Admin",
          id: "admin-1",
          isSystemAdmin: true,
          lastName: "User",
          legacyUser: "AUSER",
          state: 1,
          workflowOwnerId: null,
        }),
      } as never,
      listSolicitudCancelacionesUseCase: {} as never,
      updateSolicitudCancelacionUseCase: {} as never,
    });
    const { getBody, getStatus, response } = createResponse();
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.create(
      {
        body: {
          cbu: "0000003100012345678901",
          cuentaADebitar: "1234567890",
          cuentaBancaria: "Caja de Ahorro",
          monto: "15000",
          socio: "Juan Perez",
        },
        cookies: { accessToken: "token" },
        params: { id: "11111111-1111-4111-8111-111111111111" },
      } as never,
      response,
      next,
    );

    assert.equal(nextError, undefined);
    assert.equal(getStatus(), 201);
    assert.deepEqual(getBody(), { id: "canc-1" });
    assert.deepEqual(receivedInput, {
      cbu: "0000003100012345678901",
      createdBy: "admin-1",
      cuentaADebitar: "1234567890",
      cuentaBancaria: "Caja de Ahorro",
      currentUser: {
        id: "admin-1",
        isSystemAdmin: true,
        workflowOwnerId: null,
      },
      monto: 15000,
      notas: undefined,
      socio: "Juan Perez",
      socioLegacyId: undefined,
      solicitudId: "11111111-1111-4111-8111-111111111111",
      workflowOwnerId: "",
    });
  });

  it("rejects creating a cancelacion with an invalid body", async () => {
    const controller = new SolicitudCancelacionesController({
      createSolicitudCancelacionUseCase: {
        execute: async () => {
          throw new Error("should not be called");
        },
      } as never,
      deleteSolicitudCancelacionUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "vendedor@example.com",
          emailVerified: true,
          firstName: "Vendedor",
          id: "user-1",
          lastName: "Uno",
          legacyUser: "VUSER",
          state: 1,
          workflowOwnerId: "owner-1",
        }),
      } as never,
      listSolicitudCancelacionesUseCase: {} as never,
      updateSolicitudCancelacionUseCase: {} as never,
    });
    const { response } = createResponse();
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.create(
      {
        body: { monto: -5 },
        cookies: { accessToken: "token" },
        params: { id: "11111111-1111-4111-8111-111111111111" },
      } as never,
      response,
      next,
    );

    assert.ok(nextError instanceof Error);
    assert.equal((nextError as { name?: string }).name, "InvalidSolicitudCancelacionRequestError");
  });

  it("forwards updates by cancelacionId when patching a cancelacion", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudCancelacionesController({
      createSolicitudCancelacionUseCase: {} as never,
      deleteSolicitudCancelacionUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "vendedor@example.com",
          emailVerified: true,
          firstName: "Vendedor",
          id: "user-1",
          lastName: "Uno",
          legacyUser: "VUSER",
          state: 1,
          workflowOwnerId: "owner-1",
        }),
      } as never,
      listSolicitudCancelacionesUseCase: {} as never,
      updateSolicitudCancelacionUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return { id: "canc-1" };
        },
      } as never,
    });
    const { getBody, getStatus, response } = createResponse();
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.patch(
      {
        body: { monto: "20000" },
        cookies: { accessToken: "token" },
        params: {
          cancelacionId: "22222222-2222-4222-8222-222222222222",
          id: "11111111-1111-4111-8111-111111111111",
        },
      } as never,
      response,
      next,
    );

    assert.equal(nextError, undefined);
    assert.equal(getStatus(), 200);
    assert.deepEqual(getBody(), { id: "canc-1" });
    assert.deepEqual(receivedInput, {
      cancelacionId: "22222222-2222-4222-8222-222222222222",
      cbu: undefined,
      cuentaADebitar: undefined,
      cuentaBancaria: undefined,
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      monto: 20000,
      notas: undefined,
      socio: undefined,
      socioLegacyId: undefined,
      solicitudId: "11111111-1111-4111-8111-111111111111",
      workflowOwnerId: "owner-1",
    });
  });

  it("forwards deletedBy when deleting a cancelacion", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudCancelacionesController({
      createSolicitudCancelacionUseCase: {} as never,
      deleteSolicitudCancelacionUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return { id: "canc-1" };
        },
      } as never,
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "vendedor@example.com",
          emailVerified: true,
          firstName: "Vendedor",
          id: "user-1",
          lastName: "Uno",
          legacyUser: "VUSER",
          state: 1,
          workflowOwnerId: "owner-1",
        }),
      } as never,
      listSolicitudCancelacionesUseCase: {} as never,
      updateSolicitudCancelacionUseCase: {} as never,
    });
    const { getBody, getStatus, response } = createResponse();
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.delete(
      {
        cookies: { accessToken: "token" },
        params: {
          cancelacionId: "22222222-2222-4222-8222-222222222222",
          id: "11111111-1111-4111-8111-111111111111",
        },
      } as never,
      response,
      next,
    );

    assert.equal(nextError, undefined);
    assert.equal(getStatus(), 200);
    assert.deepEqual(getBody(), { id: "canc-1" });
    assert.deepEqual(receivedInput, {
      cancelacionId: "22222222-2222-4222-8222-222222222222",
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      deletedBy: "user-1",
      solicitudId: "11111111-1111-4111-8111-111111111111",
      workflowOwnerId: "owner-1",
    });
  });

  it("forwards a missing workflow owner assignment error when a non admin user has none", async () => {
    const controller = new SolicitudCancelacionesController({
      createSolicitudCancelacionUseCase: {
        execute: async () => {
          throw new Error("should not be called");
        },
      } as never,
      deleteSolicitudCancelacionUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "vendedor@example.com",
          emailVerified: true,
          firstName: "Vendedor",
          id: "user-1",
          lastName: "Uno",
          legacyUser: "VUSER",
          state: 1,
          workflowOwnerId: null,
        }),
      } as never,
      listSolicitudCancelacionesUseCase: {} as never,
      updateSolicitudCancelacionUseCase: {} as never,
    });
    const { response } = createResponse();
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.create(
      {
        body: {
          cbu: "0000003100012345678901",
          cuentaADebitar: "1234567890",
          cuentaBancaria: "Caja de Ahorro",
          monto: "15000",
          socio: "Juan Perez",
        },
        cookies: { accessToken: "token" },
        params: { id: "11111111-1111-4111-8111-111111111111" },
      } as never,
      response,
      next,
    );

    assert.ok(nextError instanceof Error);
    assert.equal((nextError as { name?: string }).name, "MissingWorkflowOwnerAssignmentError");
  });
});
