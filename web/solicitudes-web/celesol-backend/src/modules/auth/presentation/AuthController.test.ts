import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Response } from "express";

import {
  ForbiddenSystemAdminOnlyError,
  InvalidRequestError,
  InvalidSessionError,
} from "../domain/auth-errors";
import { AuthController } from "./AuthController";

describe("AuthController", () => {
  it("returns 403 when authenticated user is not system admin", async () => {
    let assignCalled = false;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {
        execute: async () => {
          assignCalled = true;
          return {};
        },
      } as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "user@example.com",
          emailVerified: true,
          firstName: "User",
          id: "11111111-1111-1111-1111-111111111111",
          isSystemAdmin: false,
          lastName: "Common",
          legacyUser: "UCOMMON",
          state: 2,
          workflowOwnerId: null,
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {} as never,
      verifyEmailUseCase: {} as never,
    });

    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.assignWorkflowOwner(
      {
        body: {
          workflowOwnerId: "33333333-3333-4333-8333-333333333333",
        },
        cookies: {
          accessToken: "token",
        },
        params: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      } as never,
      {
        json() {
          return this;
        },
        status() {
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(assignCalled, false);
    assert.ok(nextError instanceof ForbiddenSystemAdminOnlyError);
  });

  it("allows system admin to assign workflow owner", async () => {
    let receivedInput: unknown;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return {
            email: "target@example.com",
            emailVerified: true,
            firstName: "Target",
            id: "22222222-2222-4222-8222-222222222222",
            isSystemAdmin: false,
            lastName: "User",
            legacyUser: "TUSER",
            state: 1,
            workflowOwnerId: "33333333-3333-4333-8333-333333333333",
            workflowOwner: {
              code: "RIESGO",
              id: "33333333-3333-4333-8333-333333333333",
              name: "Área Riesgo",
            },
          };
        },
      } as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "admin@example.com",
          emailVerified: true,
          firstName: "Admin",
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          isSystemAdmin: true,
          lastName: "User",
          legacyUser: "AUSER",
          state: 1,
          workflowOwnerId: "11111111-1111-1111-1111-111111111111",
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {} as never,
      verifyEmailUseCase: {} as never,
    });

    let statusCode = 0;
    let responseBody: unknown;
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.assignWorkflowOwner(
      {
        body: {
          workflowOwnerId: "33333333-3333-4333-8333-333333333333",
        },
        cookies: {
          accessToken: "token",
        },
        params: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      } as never,
      {
        json(payload: unknown) {
          responseBody = payload;
          return this;
        },
        status(code: number) {
          statusCode = code;
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(nextError, undefined);
    assert.equal(statusCode, 200);
    assert.deepEqual(receivedInput, {
      userId: "22222222-2222-4222-8222-222222222222",
      workflowOwnerId: "33333333-3333-4333-8333-333333333333",
    });
    assert.deepEqual(responseBody, {
      user: {
        email: "target@example.com",
        emailVerified: true,
        firstName: "Target",
        id: "22222222-2222-4222-8222-222222222222",
        isSystemAdmin: false,
        lastName: "User",
        legacyUser: "TUSER",
        state: 1,
        workflowOwnerId: "33333333-3333-4333-8333-333333333333",
        workflowOwner: {
          code: "RIESGO",
          id: "33333333-3333-4333-8333-333333333333",
          name: "Área Riesgo",
        },
      },
    });
  });

  it("allows system admin to remove workflow owner with null", async () => {
    let receivedInput: unknown;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return {
            email: "target@example.com",
            emailVerified: true,
            firstName: "Target",
            id: "22222222-2222-4222-8222-222222222222",
            isSystemAdmin: false,
            lastName: "User",
            legacyUser: "TUSER",
            state: 2,
            workflowOwnerId: null,
            workflowOwner: null,
          };
        },
      } as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "admin@example.com",
          emailVerified: true,
          firstName: "Admin",
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          isSystemAdmin: true,
          lastName: "User",
          legacyUser: "AUSER",
          state: 1,
          workflowOwnerId: "11111111-1111-1111-1111-111111111111",
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {} as never,
      verifyEmailUseCase: {} as never,
    });

    let statusCode = 0;
    let responseBody: unknown;
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.assignWorkflowOwner(
      {
        body: {
          workflowOwnerId: null,
        },
        cookies: {
          accessToken: "token",
        },
        params: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      } as never,
      {
        json(payload: unknown) {
          responseBody = payload;
          return this;
        },
        status(code: number) {
          statusCode = code;
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(nextError, undefined);
    assert.equal(statusCode, 200);
    assert.deepEqual(receivedInput, {
      userId: "22222222-2222-4222-8222-222222222222",
      workflowOwnerId: null,
    });
    assert.deepEqual(responseBody, {
      user: {
        email: "target@example.com",
        emailVerified: true,
        firstName: "Target",
        id: "22222222-2222-4222-8222-222222222222",
        isSystemAdmin: false,
        lastName: "User",
        legacyUser: "TUSER",
        state: 2,
        workflowOwnerId: null,
        workflowOwner: null,
      },
    });
  });

  it("returns 403 when non-admin requests users list", async () => {
    let called = false;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "user@example.com",
          emailVerified: true,
          firstName: "User",
          id: "11111111-1111-1111-1111-111111111111",
          isSystemAdmin: false,
          lastName: "Common",
          legacyUser: "UCOMMON",
          state: 1,
          workflowOwnerId: null,
        }),
      } as never,
      listUsersUseCase: {
        execute: async () => {
          called = true;
          return [];
        },
      } as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {} as never,
      verifyEmailUseCase: {} as never,
    });

    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.listUsers(
      {
        cookies: {
          accessToken: "token",
        },
      } as never,
      {
        json() {
          return this;
        },
        status() {
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(called, false);
    assert.ok(nextError instanceof ForbiddenSystemAdminOnlyError);
  });

  it("allows admin to list users without sensitive fields", async () => {
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "admin@example.com",
          emailVerified: true,
          firstName: "Admin",
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          isSystemAdmin: true,
          lastName: "User",
          legacyUser: "AUSER",
          state: 1,
          workflowOwnerId: "11111111-1111-1111-1111-111111111111",
        }),
      } as never,
      listUsersUseCase: {
        execute: async () => [
          {
            email: "one@example.com",
            emailVerified: true,
            firstName: "One",
            id: "22222222-2222-4222-8222-222222222222",
            isSystemAdmin: false,
            lastName: "User",
            legacyUser: "ONE",
            state: 1,
            workflowOwnerId: "33333333-3333-4333-8333-333333333333",
          },
          {
            email: "two@example.com",
            emailVerified: false,
            firstName: "Two",
            id: "44444444-4444-4444-8444-444444444444",
            isSystemAdmin: false,
            lastName: "User",
            legacyUser: "TWO",
            state: 2,
            workflowOwnerId: null,
          },
        ],
      } as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {} as never,
      verifyEmailUseCase: {} as never,
    });

    let statusCode = 0;
    let responseBody: unknown;
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.listUsers(
      {
        cookies: {
          accessToken: "token",
        },
      } as never,
      {
        json(payload: unknown) {
          responseBody = payload;
          return this;
        },
        status(code: number) {
          statusCode = code;
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(nextError, undefined);
    assert.equal(statusCode, 200);
    assert.deepEqual(responseBody, {
      users: [
        {
          email: "one@example.com",
          emailVerified: true,
          firstName: "One",
          id: "22222222-2222-4222-8222-222222222222",
          isSystemAdmin: false,
          lastName: "User",
          legacyUser: "ONE",
          state: 1,
          workflowOwnerId: "33333333-3333-4333-8333-333333333333",
        },
        {
          email: "two@example.com",
          emailVerified: false,
          firstName: "Two",
          id: "44444444-4444-4444-8444-444444444444",
          isSystemAdmin: false,
          lastName: "User",
          legacyUser: "TWO",
          state: 2,
          workflowOwnerId: null,
        },
      ],
    });
    assert.equal(
      "passwordHash" in (responseBody as { users: Array<Record<string, unknown>> }).users[0],
      false,
    );
  });

  it("returns 403 when non-admin requests pending-area users", async () => {
    let called = false;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "user@example.com",
          emailVerified: true,
          firstName: "User",
          id: "11111111-1111-1111-1111-111111111111",
          isSystemAdmin: false,
          lastName: "Common",
          legacyUser: "UCOMMON",
          state: 2,
          workflowOwnerId: null,
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {
        execute: async () => {
          called = true;
          return [];
        },
      } as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {} as never,
      verifyEmailUseCase: {} as never,
    });

    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.listPendingAreaUsers(
      {
        cookies: {
          accessToken: "token",
        },
      } as never,
      {
        json() {
          return this;
        },
        status() {
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(called, false);
    assert.ok(nextError instanceof ForbiddenSystemAdminOnlyError);
  });

  it("allows admin to list pending-area users", async () => {
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "admin@example.com",
          emailVerified: true,
          firstName: "Admin",
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          isSystemAdmin: true,
          lastName: "User",
          legacyUser: "AUSER",
          state: 1,
          workflowOwnerId: "11111111-1111-1111-1111-111111111111",
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {
        execute: async () => [
          {
            email: "pending@example.com",
            emailVerified: true,
            firstName: "Pending",
            id: "22222222-2222-4222-8222-222222222222",
            isSystemAdmin: false,
            lastName: "User",
            legacyUser: "PUSER",
            state: 2,
            workflowOwnerId: null,
          },
        ],
      } as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {} as never,
      verifyEmailUseCase: {} as never,
    });

    let statusCode = 0;
    let responseBody: unknown;
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.listPendingAreaUsers(
      {
        cookies: {
          accessToken: "token",
        },
      } as never,
      {
        json(payload: unknown) {
          responseBody = payload;
          return this;
        },
        status(code: number) {
          statusCode = code;
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(nextError, undefined);
    assert.equal(statusCode, 200);
    assert.deepEqual(responseBody, {
      users: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          email: "pending@example.com",
          firstName: "Pending",
          lastName: "User",
          legacyUser: "PUSER",
          state: 2,
          workflowOwnerId: null,
        },
      ],
    });
  });

  it("returns 403 when non-admin requests workflow owners", async () => {
    let called = false;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "user@example.com",
          emailVerified: true,
          firstName: "User",
          id: "11111111-1111-1111-1111-111111111111",
          isSystemAdmin: false,
          lastName: "Common",
          legacyUser: "UCOMMON",
          state: 2,
          workflowOwnerId: null,
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {
        execute: async () => {
          called = true;
          return [];
        },
      } as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {} as never,
      verifyEmailUseCase: {} as never,
    });

    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.listWorkflowOwners(
      {
        cookies: {
          accessToken: "token",
        },
      } as never,
      {
        json() {
          return this;
        },
        status() {
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(called, false);
    assert.ok(nextError instanceof ForbiddenSystemAdminOnlyError);
  });

  it("allows admin to list workflow owners", async () => {
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "admin@example.com",
          emailVerified: true,
          firstName: "Admin",
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          isSystemAdmin: true,
          lastName: "User",
          legacyUser: "AUSER",
          state: 1,
          workflowOwnerId: "11111111-1111-1111-1111-111111111111",
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {
        execute: async () => [
          {
            code: "VENDEDORES",
            id: "33333333-3333-4333-8333-333333333333",
            name: "Vendedores",
          },
        ],
      } as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {} as never,
      verifyEmailUseCase: {} as never,
    });

    let statusCode = 0;
    let responseBody: unknown;
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.listWorkflowOwners(
      {
        cookies: {
          accessToken: "token",
        },
      } as never,
      {
        json(payload: unknown) {
          responseBody = payload;
          return this;
        },
        status(code: number) {
          statusCode = code;
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(nextError, undefined);
    assert.equal(statusCode, 200);
    assert.deepEqual(responseBody, {
      workflowOwners: [
        {
          code: "VENDEDORES",
          id: "33333333-3333-4333-8333-333333333333",
          name: "Vendedores",
        },
      ],
    });
  });

  it("returns 401 when update user request has invalid session", async () => {
    let updateCalled = false;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => {
          throw new InvalidSessionError();
        },
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {
        execute: async () => {
          updateCalled = true;
          return {};
        },
      } as never,
      verifyEmailUseCase: {} as never,
    });

    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.updateUser(
      {
        body: { state: 1 },
        cookies: {},
        params: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      } as never,
      {
        json() {
          return this;
        },
        status() {
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(updateCalled, false);
    assert.ok(nextError instanceof InvalidSessionError);
  });

  it("returns 403 when non-admin tries to update user", async () => {
    let updateCalled = false;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "user@example.com",
          emailVerified: true,
          firstName: "User",
          id: "11111111-1111-1111-1111-111111111111",
          isSystemAdmin: false,
          lastName: "Common",
          legacyUser: "UCOMMON",
          state: 1,
          workflowOwnerId: null,
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {
        execute: async () => {
          updateCalled = true;
          return {};
        },
      } as never,
      verifyEmailUseCase: {} as never,
    });

    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.updateUser(
      {
        body: { state: 1 },
        cookies: {
          accessToken: "token",
        },
        params: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      } as never,
      {
        json() {
          return this;
        },
        status() {
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(updateCalled, false);
    assert.ok(nextError instanceof ForbiddenSystemAdminOnlyError);
  });

  it("returns 400 when update payload is invalid", async () => {
    let updateCalled = false;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "admin@example.com",
          emailVerified: true,
          firstName: "Admin",
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          isSystemAdmin: true,
          lastName: "User",
          legacyUser: "AUSER",
          state: 1,
          workflowOwnerId: "11111111-1111-1111-1111-111111111111",
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {
        execute: async () => {
          updateCalled = true;
          return {};
        },
      } as never,
      verifyEmailUseCase: {} as never,
    });

    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.updateUser(
      {
        body: { state: 2 },
        cookies: {
          accessToken: "token",
        },
        params: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      } as never,
      {
        json() {
          return this;
        },
        status() {
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(updateCalled, false);
    assert.ok(nextError instanceof InvalidRequestError);
  });

  it("returns 400 when update payload email is invalid", async () => {
    let updateCalled = false;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "admin@example.com",
          emailVerified: true,
          firstName: "Admin",
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          isSystemAdmin: true,
          lastName: "User",
          legacyUser: "AUSER",
          state: 1,
          workflowOwnerId: "11111111-1111-1111-1111-111111111111",
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {
        execute: async () => {
          updateCalled = true;
          return {};
        },
      } as never,
      verifyEmailUseCase: {} as never,
    });

    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.updateUser(
      {
        body: { email: "not-an-email" },
        cookies: {
          accessToken: "token",
        },
        params: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      } as never,
      {
        json() {
          return this;
        },
        status() {
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(updateCalled, false);
    assert.ok(nextError instanceof InvalidRequestError);
  });

  it("returns 400 when update payload has unknown fields", async () => {
    let updateCalled = false;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "admin@example.com",
          emailVerified: true,
          firstName: "Admin",
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          isSystemAdmin: true,
          lastName: "User",
          legacyUser: "AUSER",
          state: 1,
          workflowOwnerId: "11111111-1111-1111-1111-111111111111",
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {
        execute: async () => {
          updateCalled = true;
          return {};
        },
      } as never,
      verifyEmailUseCase: {} as never,
    });

    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.updateUser(
      {
        body: { unknownField: "value" },
        cookies: {
          accessToken: "token",
        },
        params: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      } as never,
      {
        json() {
          return this;
        },
        status() {
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(updateCalled, false);
    assert.ok(nextError instanceof InvalidRequestError);
  });

  it("returns 400 when update payload is empty body", async () => {
    let updateCalled = false;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "admin@example.com",
          emailVerified: true,
          firstName: "Admin",
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          isSystemAdmin: true,
          lastName: "User",
          legacyUser: "AUSER",
          state: 1,
          workflowOwnerId: "11111111-1111-1111-1111-111111111111",
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {
        execute: async () => {
          updateCalled = true;
          return {};
        },
      } as never,
      verifyEmailUseCase: {} as never,
    });

    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.updateUser(
      {
        body: {},
        cookies: {
          accessToken: "token",
        },
        params: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      } as never,
      {
        json() {
          return this;
        },
        status() {
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(updateCalled, false);
    assert.ok(nextError instanceof InvalidRequestError);
  });

  it("accepts firstName in update payload", async () => {
    let receivedInput: unknown;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "admin@example.com",
          emailVerified: true,
          firstName: "Admin",
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          isSystemAdmin: true,
          lastName: "User",
          legacyUser: "AUSER",
          state: 1,
          workflowOwnerId: "11111111-1111-1111-1111-111111111111",
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;
          return {};
        },
      } as never,
      verifyEmailUseCase: {} as never,
    });

    await controller.updateUser(
      {
        body: { firstName: "Juan" },
        cookies: {
          accessToken: "token",
        },
        params: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      } as never,
      {
        json() {
          return this;
        },
        status() {
          return this;
        },
      } as unknown as Response,
      () => undefined,
    );

    assert.deepEqual(receivedInput, {
      authenticatedUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      email: undefined,
      firstName: "Juan",
      isSystemAdmin: undefined,
      lastName: undefined,
      legacyUser: undefined,
      recibeAsignacionAutomatica: undefined,
      state: undefined,
      userId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("accepts lastName in update payload", async () => {
    let called = false;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "admin@example.com",
          emailVerified: true,
          firstName: "Admin",
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          isSystemAdmin: true,
          lastName: "User",
          legacyUser: "AUSER",
          state: 1,
          workflowOwnerId: "11111111-1111-1111-1111-111111111111",
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {
        execute: async () => {
          called = true;
          return {};
        },
      } as never,
      verifyEmailUseCase: {} as never,
    });

    await controller.updateUser(
      {
        body: { lastName: "Perez" },
        cookies: {
          accessToken: "token",
        },
        params: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      } as never,
      {
        json() {
          return this;
        },
        status() {
          return this;
        },
      } as unknown as Response,
      () => undefined,
    );

    assert.equal(called, true);
  });

  it("accepts legacyUser in update payload", async () => {
    let called = false;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "admin@example.com",
          emailVerified: true,
          firstName: "Admin",
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          isSystemAdmin: true,
          lastName: "User",
          legacyUser: "AUSER",
          state: 1,
          workflowOwnerId: "11111111-1111-1111-1111-111111111111",
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {
        execute: async () => {
          called = true;
          return {};
        },
      } as never,
      verifyEmailUseCase: {} as never,
    });

    await controller.updateUser(
      {
        body: { legacyUser: "new.user" },
        cookies: {
          accessToken: "token",
        },
        params: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      } as never,
      {
        json() {
          return this;
        },
        status() {
          return this;
        },
      } as unknown as Response,
      () => undefined,
    );

    assert.equal(called, true);
  });

  it("rejects invalid firstName in update payload", async () => {
    let updateCalled = false;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "admin@example.com",
          emailVerified: true,
          firstName: "Admin",
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          isSystemAdmin: true,
          lastName: "User",
          legacyUser: "AUSER",
          state: 1,
          workflowOwnerId: "11111111-1111-1111-1111-111111111111",
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {
        execute: async () => {
          updateCalled = true;
          return {};
        },
      } as never,
      verifyEmailUseCase: {} as never,
    });

    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.updateUser(
      {
        body: { firstName: " " },
        cookies: {
          accessToken: "token",
        },
        params: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      } as never,
      {
        json() {
          return this;
        },
        status() {
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(updateCalled, false);
    assert.ok(nextError instanceof InvalidRequestError);
  });

  it("rejects invalid lastName in update payload", async () => {
    let updateCalled = false;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "admin@example.com",
          emailVerified: true,
          firstName: "Admin",
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          isSystemAdmin: true,
          lastName: "User",
          legacyUser: "AUSER",
          state: 1,
          workflowOwnerId: "11111111-1111-1111-1111-111111111111",
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {
        execute: async () => {
          updateCalled = true;
          return {};
        },
      } as never,
      verifyEmailUseCase: {} as never,
    });

    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.updateUser(
      {
        body: { lastName: " " },
        cookies: {
          accessToken: "token",
        },
        params: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      } as never,
      {
        json() {
          return this;
        },
        status() {
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(updateCalled, false);
    assert.ok(nextError instanceof InvalidRequestError);
  });

  it("rejects invalid legacyUser in update payload", async () => {
    let updateCalled = false;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "admin@example.com",
          emailVerified: true,
          firstName: "Admin",
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          isSystemAdmin: true,
          lastName: "User",
          legacyUser: "AUSER",
          state: 1,
          workflowOwnerId: "11111111-1111-1111-1111-111111111111",
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {
        execute: async () => {
          updateCalled = true;
          return {};
        },
      } as never,
      verifyEmailUseCase: {} as never,
    });

    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.updateUser(
      {
        body: { legacyUser: " " },
        cookies: {
          accessToken: "token",
        },
        params: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      } as never,
      {
        json() {
          return this;
        },
        status() {
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(updateCalled, false);
    assert.ok(nextError instanceof InvalidRequestError);
  });

  it("rejects workflowOwnerId in update payload", async () => {
    let updateCalled = false;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "admin@example.com",
          emailVerified: true,
          firstName: "Admin",
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          isSystemAdmin: true,
          lastName: "User",
          legacyUser: "AUSER",
          state: 1,
          workflowOwnerId: "11111111-1111-1111-1111-111111111111",
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {
        execute: async () => {
          updateCalled = true;
          return {};
        },
      } as never,
      verifyEmailUseCase: {} as never,
    });

    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.updateUser(
      {
        body: { workflowOwnerId: "33333333-3333-4333-8333-333333333333" },
        cookies: {
          accessToken: "token",
        },
        params: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      } as never,
      {
        json() {
          return this;
        },
        status() {
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(updateCalled, false);
    assert.ok(nextError instanceof InvalidRequestError);
  });

  it("updates own profile for the authenticated user", async () => {
    let receivedInput: unknown;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      changeOwnPasswordUseCase: {} as never,
      updateOwnProfileUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return {
            email: "user@example.com",
            emailVerified: true,
            firstName: "Nuevo",
            id: "11111111-1111-1111-1111-111111111111",
            isSystemAdmin: false,
            lastName: "User",
            legacyUser: "UUSER",
            state: 1,
            workflowOwnerId: null,
          };
        },
      } as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "user@example.com",
          emailVerified: true,
          firstName: "User",
          id: "11111111-1111-1111-1111-111111111111",
          isSystemAdmin: false,
          lastName: "User",
          legacyUser: "UUSER",
          state: 1,
          workflowOwnerId: null,
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {} as never,
      verifyEmailUseCase: {} as never,
    });

    let statusCode = 0;
    let responseBody: unknown;
    const next: NextFunction = () => undefined;

    await controller.updateOwnProfile(
      {
        body: { firstName: "Nuevo" },
        cookies: { accessToken: "token" },
      } as never,
      {
        json(payload: unknown) {
          responseBody = payload;
          return this;
        },
        status(code: number) {
          statusCode = code;
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(statusCode, 200);
    assert.deepEqual(receivedInput, {
      email: undefined,
      firstName: "Nuevo",
      lastName: undefined,
      userId: "11111111-1111-1111-1111-111111111111",
    });
    assert.deepEqual(responseBody, {
      user: {
        email: "user@example.com",
        emailVerified: true,
        firstName: "Nuevo",
        id: "11111111-1111-1111-1111-111111111111",
        isSystemAdmin: false,
        lastName: "User",
        legacyUser: "UUSER",
        state: 1,
        workflowOwnerId: null,
      },
    });
  });

  it("changes own password and clears auth cookies", async () => {
    let receivedInput: unknown;
    let cleared = false;
    const controller = new AuthController({
      assignWorkflowOwnerUseCase: {} as never,
      updateOwnProfileUseCase: {} as never,
      changeOwnPasswordUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;
        },
      } as never,
      authCookieConfig: {
        accessTokenTtlMinutes: 30,
        isProduction: false,
        refreshTokenTtlDays: 7,
      },
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "user@example.com",
          emailVerified: true,
          firstName: "User",
          id: "11111111-1111-1111-1111-111111111111",
          isSystemAdmin: false,
          lastName: "User",
          legacyUser: "UUSER",
          state: 1,
          workflowOwnerId: null,
        }),
      } as never,
      listUsersUseCase: {} as never,
      listPendingAreaUsersUseCase: {} as never,
      listWorkflowOwnersUseCase: {} as never,
      loginUserUseCase: {} as never,
      logoutUserUseCase: {} as never,
      registerUserUseCase: {} as never,
      resendVerificationCodeUseCase: {} as never,
      refreshSessionUseCase: {} as never,
      requestPasswordResetUseCase: {} as never,
      resetPasswordUseCase: {} as never,
      updateUserUseCase: {} as never,
      verifyEmailUseCase: {} as never,
    });

    let statusCode = 0;
    const next: NextFunction = () => undefined;

    await controller.changeOwnPassword(
      {
        body: { currentPassword: "Current1!", newPassword: "NewPass1!" },
        cookies: { accessToken: "token" },
      } as never,
      {
        clearCookie() {
          cleared = true;
          return this;
        },
        json() {
          return this;
        },
        status(code: number) {
          statusCode = code;
          return this;
        },
      } as unknown as Response,
      next,
    );

    assert.equal(statusCode, 200);
    assert.equal(cleared, true);
    assert.deepEqual(receivedInput, {
      currentPassword: "Current1!",
      newPassword: "NewPass1!",
      userId: "11111111-1111-1111-1111-111111111111",
    });
  });
});



