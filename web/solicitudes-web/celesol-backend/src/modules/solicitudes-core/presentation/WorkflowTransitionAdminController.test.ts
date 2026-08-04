import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Response } from "express";

import { ForbiddenSystemAdminOnlyError } from "../../auth/domain/auth-errors";
import {
  InvalidSolicitudesCoreRequestError,
  WorkflowTransitionStateNotFoundError,
  WorkflowTransitionVersionConflictError,
} from "../domain/solicitudes-core-errors";
import { WorkflowTransitionAdminController } from "./WorkflowTransitionAdminController";

describe("WorkflowTransitionAdminController", () => {
  it("allows a system admin to list transitions", async () => {
    const controller = buildController({
      listWorkflowTransitionsUseCase: {
        execute: async () => ({ states: [{ fromState: { code: "CargaVendedor" } }] }),
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.listRules(
      request(),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      states: [{ fromState: { code: "CargaVendedor" } }],
    });
  });

  it("rejects non-admin users with 403", async () => {
    const controller = buildController({
      getCurrentUserUseCase: {
        execute: async () => ({
          ...authenticatedAdmin(),
          isSystemAdmin: false,
        }),
      },
    });
    let nextError: unknown;

    await controller.listRules(
      request(),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof ForbiddenSystemAdminOnlyError);
  });

  it("gets transitions by state", async () => {
    const controller = buildController({
      getWorkflowTransitionsByStateUseCase: {
        execute: async () => ({ fromState: { code: "CargaVendedor" }, transitions: [] }),
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.getRuleByState(
      request({ params: { stateCode: "CargaVendedor" } }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      fromState: { code: "CargaVendedor" },
      transitions: [],
    });
  });

  it("passes state not found errors through next", async () => {
    const controller = buildController({
      getWorkflowTransitionsByStateUseCase: {
        execute: async () => {
          throw new WorkflowTransitionStateNotFoundError();
        },
      },
    });
    let nextError: unknown;

    await controller.getRuleByState(
      request({ params: { stateCode: "NoExiste" } }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof WorkflowTransitionStateNotFoundError);
  });

  it("updates a transition metadata record", async () => {
    const controller = buildController({
      updateWorkflowTransitionMetadataUseCase: {
        execute: async () => ({
          actionLabel: "Enviar solicitud",
          id: "tr-enviar",
        }),
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.updateRule(
      request({
        body: {
          actionLabel: "Enviar solicitud",
          defaultComment: "Pase a riesgo",
          description: null,
          requiresComment: true,
          sortOrder: 10,
          updatedAt: "2026-06-11T10:00:00.000Z",
        },
        params: { transitionId: "11111111-1111-4111-8111-111111111111" },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      actionLabel: "Enviar solicitud",
      id: "tr-enviar",
    });
  });

  it("passes version conflict errors from update", async () => {
    const controller = buildController({
      updateWorkflowTransitionMetadataUseCase: {
        execute: async () => {
          throw new WorkflowTransitionVersionConflictError();
        },
      },
    });
    let nextError: unknown;

    await controller.updateRule(
      request({
        body: {
          actionLabel: "Enviar solicitud",
          defaultComment: null,
          description: null,
          requiresComment: false,
          sortOrder: 10,
          updatedAt: "2026-06-11T10:00:00.000Z",
        },
        params: { transitionId: "11111111-1111-4111-8111-111111111111" },
      }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof WorkflowTransitionVersionConflictError);
  });

  it("rejects malformed update bodies", async () => {
    const controller = buildController();
    let nextError: unknown;

    await controller.updateRule(
      request({
        body: {
          actionLabel: "Enviar solicitud",
          sortOrder: 10,
        },
        params: { transitionId: "11111111-1111-4111-8111-111111111111" },
      }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof InvalidSolicitudesCoreRequestError);
  });

  it("rejects blocked workflow fields in update body", async () => {
    const controller = buildController();
    let nextError: unknown;

    await controller.updateRule(
      request({
        body: {
          actionCode: "hack",
          actionLabel: "Enviar solicitud",
          defaultComment: null,
          description: null,
          fromStateId: "state-carga",
          isActive: false,
          requiresComment: true,
          sortOrder: 10,
          toStateId: "state-riesgo",
          updatedAt: "2026-06-11T10:00:00.000Z",
        },
        params: { transitionId: "11111111-1111-4111-8111-111111111111" },
      }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof InvalidSolicitudesCoreRequestError);
  });
});

function buildController(
  overrides?: Partial<{
    getCurrentUserUseCase: unknown;
    getWorkflowTransitionsByStateUseCase: unknown;
    listWorkflowTransitionsUseCase: unknown;
    updateWorkflowTransitionMetadataUseCase: unknown;
  }>,
) {
  return new WorkflowTransitionAdminController({
    getCurrentUserUseCase: ({
      execute: async () => authenticatedAdmin(),
      ...(overrides?.getCurrentUserUseCase ?? {}),
    } as never),
    getWorkflowTransitionsByStateUseCase: ({
      execute: async () => ({ fromState: { code: "CargaVendedor" }, transitions: [] }),
      ...(overrides?.getWorkflowTransitionsByStateUseCase ?? {}),
    } as never),
    listWorkflowTransitionsUseCase: ({
      execute: async () => ({ states: [] }),
      ...(overrides?.listWorkflowTransitionsUseCase ?? {}),
    } as never),
    updateWorkflowTransitionMetadataUseCase: ({
      execute: async () => ({ id: "tr-enviar" }),
      ...(overrides?.updateWorkflowTransitionMetadataUseCase ?? {}),
    } as never),
  });
}

function authenticatedAdmin() {
  return {
    email: "admin@example.com",
    emailVerified: true,
    firstName: "Admin",
    id: "admin-1",
    isSystemAdmin: true,
    lastName: "User",
    legacyUser: "ADMIN",
    state: 1,
    workflowOwnerId: "owner-admin",
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
    statusCode: 0,
    json(payload: unknown) {
      response.body = payload;
      return response;
    },
    status(code: number) {
      response.statusCode = code;
      return response;
    },
  };

  return response as unknown as Response & {
    body: unknown;
    statusCode: number;
  };
}

function request(input?: {
  body?: unknown;
  params?: Record<string, string>;
}) {
  return {
    body: input?.body ?? {},
    cookies: {
      accessToken: "token",
    },
    params: input?.params ?? {},
  } as never;
}
