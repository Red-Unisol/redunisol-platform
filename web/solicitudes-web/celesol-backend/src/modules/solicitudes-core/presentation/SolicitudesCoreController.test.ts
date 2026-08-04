import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Response } from "express";

import { SolicitudesCoreController } from "./SolicitudesCoreController";
import {
  ForbiddenSolicitudAccessError,
  InvalidSolicitudesCoreRequestError,
  MissingWorkflowOwnerAssignmentError,
  SolicitudAlreadyAssignedError,
  SolicitudCoreNotFoundError,
} from "../domain/solicitudes-core-errors";

describe("SolicitudesCoreController", () => {
  it("passes solicitud id and current workflow owner when listing transitions", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => authenticatedUser(),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      listSolicitudTransitionsUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return [{ id: "transition-1" }];
        },
      },
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    } as never);
    const response = createResponse();
    let nextError: unknown;

    await controller.listTransitions(
      request({ params: { id: solicitudId() } }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, [{ id: "transition-1" }]);
    assert.deepEqual(receivedInput, {
      solicitudId: solicitudId(),
      workflowOwnerId: "owner-1",
    });
  });

  it("passes action, comment, motivo and current user identity when changing state", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => authenticatedUser(),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      changeSolicitudStateUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return { solicitud: { id: "sol-1" }, transitions: [] };
        },
      },
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    } as never);
    const response = createResponse();
    let nextError: unknown;

    await controller.changeState(
      request({
        body: {
          actionCode: "revisar",
          comment: "Falta documentacion",
          reason: "Documentacion incompleta",
        },
        params: { id: solicitudId() },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { solicitud: { id: "sol-1" }, transitions: [] });
    assert.deepEqual(receivedInput, {
      actionCode: "revisar",
      comment: "Falta documentacion",
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      motivo: "Documentacion incompleta",
      solicitudId: solicitudId(),
    });
  });

  it("passes solicitud id and current user when listing history", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => authenticatedUser(),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      listSolicitudHistoryUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return [{ id: "hist-1" }];
        },
      },
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    } as never);
    const response = createResponse();
    let nextError: unknown;

    await controller.listHistory(
      request({ params: { id: solicitudId() } }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, [{ id: "hist-1" }]);
    assert.deepEqual(receivedInput, {
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      solicitudId: solicitudId(),
    });
  });

  it("rejects destination state fields in change state payloads", async () => {
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => authenticatedUser(),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      changeSolicitudStateUseCase: {
        execute: async () => {
          throw new Error("not used");
        },
      },
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    } as never);
    let nextError: unknown;

    await controller.changeState(
      request({
        body: {
          actionCode: "revisar",
          toStateCode: "Confirmada",
        },
        params: { id: solicitudId() },
      }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof InvalidSolicitudesCoreRequestError);
  });

  it("bypasses the workflow owner requirement on workflow endpoints for system admins", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => ({
          ...authenticatedUser(),
          isSystemAdmin: true,
          workflowOwnerId: null,
        }),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      listSolicitudTransitionsUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return [{ id: "transition-1" }];
        },
      },
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    } as never);
    const response = createResponse();
    let nextError: unknown;

    await controller.listTransitions(
      request({ params: { id: solicitudId() } }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(receivedInput, {
      isSystemAdmin: true,
      solicitudId: solicitudId(),
      workflowOwnerId: "",
    });
  });

  it("bypasses workflow owner assignment for system admins when changing state", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => ({
          ...authenticatedUser(),
          isSystemAdmin: true,
          workflowOwnerId: null,
        }),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      changeSolicitudStateUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return { solicitud: { id: "sol-1" }, transitions: [] };
        },
      },
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    } as never);
    const response = createResponse();
    let nextError: unknown;

    await controller.changeState(
      request({
        body: { actionCode: "revisar" },
        params: { id: solicitudId() },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(receivedInput, {
      actionCode: "revisar",
      comment: undefined,
      currentUser: {
        id: "user-1",
        isSystemAdmin: true,
        workflowOwnerId: "",
      },
      motivo: undefined,
      solicitudId: solicitudId(),
    });
  });

  it("omits the work-scope workflow owner requirement and forwards isSystemAdmin when listing", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => ({
          ...authenticatedUser(),
          isSystemAdmin: true,
          workflowOwnerId: null,
        }),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      ...workflowUseCases(),
      listSolicitudesUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;
          return [];
        },
      } as never,
      updateSolicitudUseCase: {} as never,
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.list(
      request({
        query: {
          limit: "20",
          offset: "0",
        },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(receivedInput, {
      currentUser: {
        id: "user-1",
        isSystemAdmin: true,
        workflowOwnerId: null,
      },
      limit: 20,
      offset: 0,
      scope: "work",
    });
  });

  it("forwards isSystemAdmin without requiring a workflow owner when getting detail", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => ({
          ...authenticatedUser(),
          isSystemAdmin: true,
          workflowOwnerId: null,
        }),
      } as never,
      getSolicitudByIdUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return { capabilities: { canEdit: true }, id: "sol-1" };
        },
      } as never,
      ...workflowUseCases(),
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.getById(
      request({ params: { id: solicitudId() } }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(receivedInput, {
      currentUser: {
        id: "user-1",
        isSystemAdmin: true,
        workflowOwnerId: null,
      },
      id: solicitudId(),
    });
  });

  it("bypasses the workflow owner requirement and forwards isSystemAdmin when updating", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => ({
          ...authenticatedUser(),
          isSystemAdmin: true,
          workflowOwnerId: null,
        }),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      ...workflowUseCases(),
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;
          return { id: "sol-1" };
        },
      } as never,
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.update(
      request({
        body: {
          solicitud: {
            ejecutivoSolicitud: "Reasignado por soporte",
          },
        },
        params: { id: solicitudId() },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(receivedInput, {
      createdBy: "user-1",
      createdByLegacyUser: "EGALLAY",
      currentUser: {
        id: "user-1",
        isSystemAdmin: true,
        workflowOwnerId: null,
      },
      id: solicitudId(),
      solicitud: {
        ejecutivoSolicitud: "Reasignado por soporte",
      },
    });
  });

  it("passes authenticated seller name formatted from firstName and lastName into create use case", async () => {
    let receivedInput: unknown;
    const createSolicitudUseCase = {
      execute: async (input: unknown) => {
        receivedInput = input;

        return { id: "sol-1" };
      },
    };
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase:
        createSolicitudUseCase as never,
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "elias@example.com",
          emailVerified: true,
          firstName: "ELIAS",
          id: "user-1",
          lastName: "gallay",
          legacyUser: "EGALLAY",
          workflowOwnerId: "owner-1",
        }),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      ...workflowUseCases(),
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    });
    let statusCode = 0;
    let responseBody: unknown;
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
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.create(
      {
        body: {
          datosLaborales: {},
          fechaPrimerVencimiento: "2026-06-01",
          lineaPrestamoLegacyOid: "LP-1",
          nroOperacion: "OP-123",
          cupoTitular: 150000,
          titular: {
            apellidoDenominacion: "Perez",
            estadoCivil: "Soltero",
            nacionalidad: "Argentina",
            nombre: "Juan",
            nroDocumento: "33344455",
            personaExpuestaPoliticamente: true,
            sexo: "M",
            telefonoFijo: "1144444444",
            tipoDocumento: "DNI",
          },
          vendedorSolicitud: "VENDEDOR_FALSO",
        },
        cookies: {
          accessToken: "token",
        },
      } as never,
      response,
      next,
    );

    assert.equal(nextError, undefined);
    assert.equal(statusCode, 201);
    assert.deepEqual(responseBody, { id: "sol-1" });
    assert.deepEqual(receivedInput, {
      authenticatedSellerName: "Elias Gallay",
      createdBy: "user-1",
      createdByLegacyUser: "EGALLAY",
      datosLaborales: {},
      lineaPrestamoLegacyOid: "LP-1",
      cupoTitular: 150000,
      fechaPrimerVencimiento: "2026-06-01",
      nroOperacion: "OP-123",
      titular: {
        apellidoDenominacion: "Perez",
        estadoCivil: "Soltero",
        nacionalidad: "Argentina",
        nombre: "Juan",
        nroDocumento: "33344455",
        personaExpuestaPoliticamente: true,
        sexo: "M",
        telefonoFijo: "1144444444",
        tipoDocumento: "DNI",
      },
      vendedorSolicitud: "VENDEDOR_FALSO",
    });
  });

  it("rejects forbidden canonical lookalike fields in patch payloads", async () => {
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {
        execute: async () => ({ id: "sol-1" }),
      } as never,
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "elias@example.com",
          emailVerified: true,
          firstName: "ELIAS",
          id: "user-1",
          lastName: "gallay",
          legacyUser: "EGALLAY",
          workflowOwnerId: "owner-1",
        }),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      ...workflowUseCases(),
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {
        execute: async () => ({ id: "sol-1" }),
      } as never,
    });
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.update(
      {
        body: {
          solicitud: {
            nioOperacion: "OP-1",
          },
          titular: {
            codigoTitular: "150000",
            noInterno: "123",
            nroInterno: "123",
          },
          estado: "CargaVendedor",
          ultimaNovedad: "algo",
        },
        cookies: {
          accessToken: "token",
        },
        params: {
          id: "sol-1",
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

    assert.ok(nextError instanceof InvalidSolicitudesCoreRequestError);
  });

  it("delegates assign to self using authenticated user", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      ...workflowUseCases(),
      assignSolicitudToSelfUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;
          return { assignedToUserId: "user-1", id: "sol-1" };
        },
      } as never,
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => authenticatedUser(),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.assignToSelf(
      request({
        body: {},
        params: { id: solicitudId() },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { assignedToUserId: "user-1", id: "sol-1" });
    assert.deepEqual(receivedInput, {
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      solicitudId: solicitudId(),
    });
  });

  it("delegates create prestamo legacy using authenticated user and returns the updated solicitud", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      ...workflowUseCases(),
      createPrestamoLegacyUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;
          return { id: "sol-1", legacyOid: "555000" };
        },
      } as never,
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => authenticatedUser(),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.createPrestamoLegacy(
      request({
        params: { id: solicitudId() },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { id: "sol-1", legacyOid: "555000" });
    assert.deepEqual(receivedInput, {
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      solicitudId: solicitudId(),
    });
  });

  it("lists assignable agents for the solicitud using authenticated current user", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      ...workflowUseCases(),
      listAssignableSolicitudAgentsUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;
          return [{ email: "agent@example.com", fullName: "Agent User", id: "agent-1" }];
        },
      } as never,
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => authenticatedUser(),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.listAssignableAgents(
      request({
        params: { id: solicitudId() },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, [
      { email: "agent@example.com", fullName: "Agent User", id: "agent-1" },
    ]);
    assert.deepEqual(receivedInput, {
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      solicitudId: solicitudId(),
    });
  });

  it("rejects assign-to-self when client tries to send actor override in body.user", async () => {
    const controller = new SolicitudesCoreController({
      ...workflowUseCases(),
      assignSolicitudToSelfUseCase: {
        execute: async () => {
          throw new Error("not used");
        },
      } as never,
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => authenticatedUser(),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    });
    let nextError: unknown;

    await controller.assignToSelf(
      request({
        body: {
          user: {
            usr_idt_id: "11111111-1111-4111-8111-111111111111",
            workflowOwnerId: "22222222-2222-4222-8222-222222222222",
          },
        },
        params: { id: solicitudId() },
      }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof InvalidSolicitudesCoreRequestError);
  });

  it("delegates assign to self when body is empty object", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      ...workflowUseCases(),
      assignSolicitudToSelfUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;
          return { assignedToUserId: "user-1", id: "sol-1" };
        },
      } as never,
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => authenticatedUser(),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.assignToSelf(
      request({
        body: {},
        params: { id: solicitudId() },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { assignedToUserId: "user-1", id: "sol-1" });
    assert.deepEqual(receivedInput, {
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      solicitudId: solicitudId(),
    });
  });

  it("delegates assign to user with targetUserId using authenticated user", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      ...workflowUseCases(),
      assignSolicitudToUserUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;
          return { assignedToUserId: "33333333-3333-4333-8333-333333333333", id: "sol-1" };
        },
      } as never,
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => authenticatedUser(),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.assignToUser(
      request({
        body: {
          targetUserId: "33333333-3333-4333-8333-333333333333",
        },
        params: { id: solicitudId() },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(receivedInput, {
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      solicitudId: solicitudId(),
      targetUserId: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("rejects assignment body with invalid targetUserId", async () => {
    const controller = new SolicitudesCoreController({
      ...workflowUseCases(),
      assignSolicitudToUserUseCase: {
        execute: async () => {
          throw new Error("not used");
        },
      } as never,
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {} as never,
      getSolicitudByIdUseCase: {} as never,
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    });
    let nextError: unknown;

    await controller.assignToUser(
      request({
        body: {
          targetUserId: "invalid",
        },
        params: { id: solicitudId() },
      }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof InvalidSolicitudesCoreRequestError);
  });

  it("rejects assign-to-user when client tries to send actor override in body.user", async () => {
    const controller = new SolicitudesCoreController({
      ...workflowUseCases(),
      assignSolicitudToUserUseCase: {
        execute: async () => {
          throw new Error("not used");
        },
      } as never,
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => authenticatedUser(),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    });
    let nextError: unknown;

    await controller.assignToUser(
      request({
        body: {
          targetUserId: "33333333-3333-4333-8333-333333333333",
          user: {
            usr_idt_id: "11111111-1111-4111-8111-111111111111",
            workflowOwnerId: "22222222-2222-4222-8222-222222222222",
          },
        },
        params: { id: solicitudId() },
      }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof InvalidSolicitudesCoreRequestError);
  });

  it("maps assignment domain errors through next without business logic duplication", async () => {
    const notFoundError = new SolicitudCoreNotFoundError();
    const forbiddenError = new ForbiddenSolicitudAccessError();
    const conflictError = new SolicitudAlreadyAssignedError();
    const controller = new SolicitudesCoreController({
      ...workflowUseCases(),
      assignSolicitudToSelfUseCase: {
        execute: async () => {
          throw notFoundError;
        },
      } as never,
      assignSolicitudToUserUseCase: {
        execute: async () => {
          throw forbiddenError;
        },
      } as never,
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => authenticatedUser(),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {
        execute: async () => {
          throw conflictError;
        },
      } as never,
    });
    let nextError: unknown;

    await controller.assignToSelf(
      request({
        body: {},
        params: { id: solicitudId() },
      }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );
    assert.equal(nextError, notFoundError);

    await controller.assignToUser(
      request({
        body: {
          targetUserId: "33333333-3333-4333-8333-333333333333",
        },
        params: { id: solicitudId() },
      }),
      createResponse(),
      captureNextError((error) => {
        nextError = error;
      }),
    );
    assert.equal(nextError, forbiddenError);
  });

  it("returns controlled 403 error when authenticated user has no workflow owner", async () => {
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
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
      getSolicitudByIdUseCase: {} as never,
      ...workflowUseCases(),
      listSolicitudesUseCase: {
        execute: async () => [],
      } as never,
      updateSolicitudUseCase: {} as never,
    });
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.list(
      {
        cookies: {
          accessToken: "token",
        },
        query: {
          limit: "20",
          offset: "0",
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

    assert.ok(nextError instanceof MissingWorkflowOwnerAssignmentError);
  });

  it("does not require workflow owner when listing tracking scope", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => ({
          email: "pending@example.com",
          emailVerified: true,
          firstName: "Pending",
          id: "user-1",
          isSystemAdmin: false,
          lastName: "User",
          legacyUser: "PUSER",
          state: 2,
          workflowOwnerId: null,
        }),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      ...workflowUseCases(),
      listSolicitudesUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;
          return [];
        },
      } as never,
      updateSolicitudUseCase: {} as never,
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.list(
      request({
        query: {
          excludeEstado: "CargaVendedor",
          limit: "20",
          offset: "0",
          scope: "tracking",
        },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(receivedInput, {
      currentUser: {
        id: "user-1",
        workflowOwnerId: null,
      },
      excludeEstado: "CargaVendedor",
      limit: 20,
      offset: 0,
      scope: "tracking",
    });
  });

  it("accepts recientes scope and delegates it to list use case", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => authenticatedUser(),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      ...workflowUseCases(),
      listSolicitudesUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;
          return [];
        },
      } as never,
      updateSolicitudUseCase: {} as never,
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.list(
      request({
        query: {
          limit: "20",
          offset: "0",
          scope: "recientes",
        },
      }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(receivedInput, {
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      limit: 20,
      offset: 0,
      scope: "recientes",
    });
  });

  it("passes current user without requiring workflow owner when getting detail", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
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
      getSolicitudByIdUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return {
            capabilities: {
              canEdit: false,
              canView: true,
              canUploadAdjuntos: false,
              canDeleteAdjuntos: false,
              canDownloadAdjuntos: true,
              canChangeState: false,
              canViewHistory: true,
              fieldAccess: {
                defaultMode: "readonly",
                editableFields: [],
                editableGroups: [],
                readonlyReason:
                  "La solicitud no admite edicion de datos en su estado actual.",
              },
            },
            id: "sol-1",
          };
        },
      } as never,
      ...workflowUseCases(),
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    });
    const response = createResponse();
    let nextError: unknown;

    await controller.getById(
      {
        cookies: {
          accessToken: "token",
        },
        params: {
          id: solicitudId(),
        },
      } as never,
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      capabilities: {
        canEdit: false,
        canView: true,
        canUploadAdjuntos: false,
        canDeleteAdjuntos: false,
        canDownloadAdjuntos: true,
        canChangeState: false,
        canViewHistory: true,
        fieldAccess: {
          defaultMode: "readonly",
          editableFields: [],
          editableGroups: [],
          readonlyReason:
            "La solicitud no admite edicion de datos en su estado actual.",
        },
      },
      id: "sol-1",
    });
    assert.deepEqual(receivedInput, {
      currentUser: {
        id: "user-1",
        workflowOwnerId: null,
      },
      id: solicitudId(),
    });
  });

  it("returns controlled 403 on create when authenticated user has no workflow owner", async () => {
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {
        execute: async () => ({ id: "sol-1" }),
      } as never,
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
      getSolicitudByIdUseCase: {} as never,
      ...workflowUseCases(),
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    });
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.create(
      {
        body: {
          datosLaborales: {},
          lineaPrestamoLegacyOid: "LP-1",
          titular: {
            apellidoDenominacion: "Perez",
            nombre: "Juan",
            nroDocumento: "33344455",
            tipoDocumento: "DNI",
          },
        },
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

    assert.ok(nextError instanceof MissingWorkflowOwnerAssignmentError);
  });

  it("returns controlled 403 on update when authenticated user has no workflow owner", async () => {
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
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
      getSolicitudByIdUseCase: {} as never,
      ...workflowUseCases(),
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {
        execute: async () => ({ id: "sol-1" }),
      } as never,
    });
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.update(
      {
        body: {
          solicitud: {
            observaciones: "update",
          },
        },
        cookies: {
          accessToken: "token",
        },
        params: {
          id: "11111111-1111-1111-1111-111111111111",
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

    assert.ok(nextError instanceof MissingWorkflowOwnerAssignmentError);
  });

  it("returns forbidden when a non-admin user requests solicitud stats", async () => {
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => authenticatedUser(),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      getSolicitudesStatsUseCase: {
        execute: async () => {
          throw new Error("not used");
        },
      } as never,
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    } as never);
    const response = createResponse();
    let nextError: unknown;

    await controller.getStats(
      request({}),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.ok(nextError instanceof ForbiddenSolicitudAccessError);
    assert.equal(response.statusCode, 0);
  });

  it("returns stats for a system admin", async () => {
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => ({ ...authenticatedUser(), isSystemAdmin: true }),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      getSolicitudesStatsUseCase: {
        execute: async () => ({ kpis: { creadasPeriodo: 3 } }),
      } as never,
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    } as never);
    const response = createResponse();
    let nextError: unknown;

    await controller.getStats(
      request({ query: { fechaDesde: "2026-07-01", fechaHasta: "2026-07-31" } }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { kpis: { creadasPeriodo: 3 } });
  });

  it("scopes vendedor stats to the authenticated user's own id", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
      getCurrentUserUseCase: {
        execute: async () => authenticatedUser(),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      getVendedorDashboardStatsUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;
          return { kpis: { solicitudesIniciadas: 2 } };
        },
      } as never,
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    } as never);
    const response = createResponse();
    let nextError: unknown;

    await controller.getVendedorStats(
      request({ query: { fechaDesde: "2026-07-01", fechaHasta: "2026-07-31" } }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(receivedInput, {
      fechaDesde: "2026-07-01",
      fechaHasta: "2026-07-31",
      vendedorId: "user-1",
    });
  });

  it("scopes analista stats to the authenticated user's own id and owner", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
      getAnalistaDashboardStatsUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;
          return { kpis: { asignadosAMi: 5 } };
        },
      } as never,
      getCurrentUserUseCase: {
        execute: async () => authenticatedUser(),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    } as never);
    const response = createResponse();
    let nextError: unknown;

    await controller.getAnalistaStats(
      request({ query: { umbralDias: "7", vista: "mis_casos" } }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(receivedInput, {
      analistaId: "user-1",
      umbralDias: 7,
      vista: "mis_casos",
      workflowOwnerId: "owner-1",
    });
  });

  it("scopes analista v2 stats to the authenticated user's own id and owner", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudesCoreController({
      createSolicitudUseCase: {} as never,
      getAnalistaDashboardStatsV2UseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;
          return { kpis: { asignadosAMi: 5 } };
        },
      } as never,
      getCurrentUserUseCase: {
        execute: async () => authenticatedUser(),
      } as never,
      getSolicitudByIdUseCase: {} as never,
      listSolicitudesUseCase: {} as never,
      updateSolicitudUseCase: {} as never,
    } as never);
    const response = createResponse();
    let nextError: unknown;

    await controller.getAnalistaStatsV2(
      request({ query: { umbralDias: "7", vista: "mis_casos" } }),
      response,
      captureNextError((error) => {
        nextError = error;
      }),
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(receivedInput, {
      analistaId: "user-1",
      umbralDias: 7,
      vista: "mis_casos",
      workflowOwnerId: "owner-1",
    });
  });
});

function authenticatedUser() {
  return {
    email: "elias@example.com",
    emailVerified: true,
    firstName: "ELIAS",
    id: "user-1",
    isSystemAdmin: false,
    lastName: "gallay",
    legacyUser: "EGALLAY",
    state: 1,
    workflowOwnerId: "owner-1",
  };
}

function workflowUseCases() {
  return {
    assignSolicitudToSelfUseCase: {
      execute: async () => ({ id: "sol-1", assignedToUserId: "user-1" }),
    } as never,
    createPrestamoLegacyUseCase: {
      execute: async () => ({ id: "sol-1", legacyOid: "555000" }),
    } as never,
    assignSolicitudToUserUseCase: {
      execute: async () => ({ id: "sol-1", assignedToUserId: "user-2" }),
    } as never,
    changeSolicitudStateUseCase: {
      execute: async () => ({ solicitud: { id: "sol-1" }, transitions: [] }),
    } as never,
    listSolicitudHistoryUseCase: {
      execute: async () => [],
    } as never,
    listAssignableSolicitudAgentsUseCase: {
      execute: async () => [],
    } as never,
    listSolicitudTransitionsUseCase: {
      execute: async () => [],
    } as never,
    simularPrestamoUseCase: {
      execute: async () => ({}),
    } as never,
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

function request(input: {
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
}) {
  return {
    body: input.body ?? {},
    cookies: {
      accessToken: "token",
    },
    params: input.params ?? {},
    query: input.query ?? {},
  } as never;
}

function solicitudId() {
  return "11111111-1111-4111-8111-111111111111";
}
