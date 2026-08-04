import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Response } from "express";

import { ForbiddenSystemAdminOnlyError } from "../../auth/domain/auth-errors";
import {
  FieldAccessRuleStateNotFoundError,
  FieldAccessRuleVersionConflictError,
  InvalidSolicitudesCoreRequestError,
} from "../domain/solicitudes-core-errors";
import { FieldAccessAdminController } from "./FieldAccessAdminController";

describe("FieldAccessAdminController", () => {
  it("allows a system admin to list rules", async () => {
    const controller = buildController({
      listFieldAccessRulesUseCase: {
        execute: async () => ({ rules: [{ state: { code: "CargaVendedor" } }] }),
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
      rules: [{ state: { code: "CargaVendedor" } }],
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

  it("gets one rule by state", async () => {
    const controller = buildController({
      getFieldAccessRuleByStateUseCase: {
        execute: async () => ({ state: { code: "CargaVendedor" } }),
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
    assert.deepEqual(response.body, { state: { code: "CargaVendedor" } });
  });

  it("passes state not found errors through next", async () => {
    const controller = buildController({
      getFieldAccessRuleByStateUseCase: {
        execute: async () => {
          throw new FieldAccessRuleStateNotFoundError();
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

    assert.ok(nextError instanceof FieldAccessRuleStateNotFoundError);
  });

  it("returns the field catalog", async () => {
    const controller = buildController({
      getFieldAccessFieldCatalogUseCase: {
        execute: async () => ({ allowedDefaultModes: ["readonly"] }),
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.getFieldCatalog(
      request(),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { allowedDefaultModes: ["readonly"] });
  });

  it("updates a rule", async () => {
    const controller = buildController({
      updateFieldAccessRuleUseCase: {
        execute: async () => ({
          rule: { version: 2 },
        }),
      },
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.updateRule(
      request({
        body: {
          active: true,
          canManageAttachments: true,
          editableFields: ["solicitud.motivo"],
          editableGroups: [],
          version: 1,
        },
        params: { stateCode: "CargaVendedor" },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { rule: { version: 2 } });
  });

  it("passes version conflict errors from update", async () => {
    const controller = buildController({
      updateFieldAccessRuleUseCase: {
        execute: async () => {
          throw new FieldAccessRuleVersionConflictError();
        },
      },
    });
    let nextError: unknown;

    await controller.updateRule(
      request({
        body: {
          active: true,
          canManageAttachments: true,
          editableFields: ["solicitud.motivo"],
          editableGroups: [],
          version: 1,
        },
        params: { stateCode: "CargaVendedor" },
      }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof FieldAccessRuleVersionConflictError);
  });

  it("rejects malformed update bodies", async () => {
    const controller = buildController();
    let nextError: unknown;

    await controller.updateRule(
      request({
        body: {
          active: true,
          editableFields: ["solicitud.motivo"],
        },
        params: { stateCode: "CargaVendedor" },
      }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof InvalidSolicitudesCoreRequestError);
  });

  it("rejects update bodies when canManageAttachments is missing", async () => {
    const controller = buildController();
    let nextError: unknown;

    await controller.updateRule(
      request({
        body: {
          active: true,
          editableFields: ["solicitud.motivo"],
          editableGroups: [],
          readonlyReason: null,
          version: 1,
        },
        params: { stateCode: "CargaVendedor" },
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
    getFieldAccessFieldCatalogUseCase: unknown;
    getFieldAccessRuleByStateUseCase: unknown;
    listFieldAccessRulesUseCase: unknown;
    updateFieldAccessRuleUseCase: unknown;
  }>,
) {
  return new FieldAccessAdminController({
    getCurrentUserUseCase: ({
      execute: async () => authenticatedAdmin(),
      ...(overrides?.getCurrentUserUseCase ?? {}),
    } as never),
    getFieldAccessFieldCatalogUseCase: ({
      execute: async () => ({ allowedDefaultModes: ["readonly"] }),
      ...(overrides?.getFieldAccessFieldCatalogUseCase ?? {}),
    } as never),
    getFieldAccessRuleByStateUseCase: ({
      execute: async () => ({ state: { code: "CargaVendedor" } }),
      ...(overrides?.getFieldAccessRuleByStateUseCase ?? {}),
    } as never),
    listFieldAccessRulesUseCase: ({
      execute: async () => ({ rules: [] }),
      ...(overrides?.listFieldAccessRulesUseCase ?? {}),
    } as never),
    updateFieldAccessRuleUseCase: ({
      execute: async () => ({ rule: { version: 2 } }),
      ...(overrides?.updateFieldAccessRuleUseCase ?? {}),
    } as never),
  } as never);
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
