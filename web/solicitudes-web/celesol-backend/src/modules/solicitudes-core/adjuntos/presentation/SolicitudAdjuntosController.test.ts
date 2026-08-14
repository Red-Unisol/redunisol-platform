import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Response } from "express";

import { SolicitudAdjuntosController } from "./SolicitudAdjuntosController";

describe("SolicitudAdjuntosController", () => {
  it("passes current user without requiring workflow owner when listing adjuntos", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudAdjuntosController({
      deleteSolicitudAdjuntoUseCase: {} as never,
      downloadSolicitudAdjuntoUseCase: {} as never,
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
      listSolicitudAdjuntosUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return [];
        },
      } as never,
      updateSolicitudAdjuntoUseCase: {} as never,
      uploadSolicitudAdjuntoUseCase: {} as never,
      uploadSolicitudAdjuntosBatchUseCase: {} as never,
    });
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
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.list(
      {
        cookies: {
          accessToken: "token",
        },
        params: {
          id: "11111111-1111-4111-8111-111111111111",
        },
      } as never,
      response,
      next,
    );

    assert.equal(nextError, undefined);
    assert.equal(statusCode, 200);
    assert.deepEqual(responseBody, []);
    assert.deepEqual(receivedInput, {
      currentUser: {
        id: "user-1",
        workflowOwnerId: null,
      },
      solicitudId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("bypasses the workflow owner requirement and forwards isSystemAdmin when uploading", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudAdjuntosController({
      deleteSolicitudAdjuntoUseCase: {} as never,
      downloadSolicitudAdjuntoUseCase: {} as never,
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
      listSolicitudAdjuntosUseCase: {} as never,
      updateSolicitudAdjuntoUseCase: {} as never,
      uploadSolicitudAdjuntoUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return { id: "adjunto-1" };
        },
      } as never,
      uploadSolicitudAdjuntosBatchUseCase: {} as never,
    });
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
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.upload(
      {
        body: {},
        cookies: {
          accessToken: "token",
        },
        file: {
          buffer: Buffer.from("contenido"),
          mimetype: "application/pdf",
          originalname: "recibo.pdf",
          size: 9,
        },
        params: {
          id: "11111111-1111-4111-8111-111111111111",
        },
      } as never,
      response,
      next,
    );

    assert.equal(nextError, undefined);
    assert.equal(statusCode, 201);
    assert.deepEqual(responseBody, { id: "adjunto-1" });
    assert.deepEqual(receivedInput, {
      adicional: undefined,
      comentario: undefined,
      createdBy: "admin-1",
      currentUser: {
        id: "admin-1",
        isSystemAdmin: true,
        workflowOwnerId: null,
      },
      descripcion: undefined,
      file: {
        buffer: Buffer.from("contenido"),
        fileName: "recibo.pdf",
        mimeType: "application/pdf",
        size: 9,
      },
      nroDocumento: undefined,
      restringido: undefined,
      solicitudId: "11111111-1111-4111-8111-111111111111",
      tipoAdjunto: undefined,
      workflowOwnerId: "",
    });
  });

  it("bypasses the workflow owner requirement and forwards isSystemAdmin when patching an adjunto", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudAdjuntosController({
      deleteSolicitudAdjuntoUseCase: {} as never,
      downloadSolicitudAdjuntoUseCase: {} as never,
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
      listSolicitudAdjuntosUseCase: {} as never,
      updateSolicitudAdjuntoUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return { id: "adjunto-1" };
        },
      } as never,
      uploadSolicitudAdjuntoUseCase: {} as never,
      uploadSolicitudAdjuntosBatchUseCase: {} as never,
    });
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
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.patch(
      {
        body: {},
        cookies: {
          accessToken: "token",
        },
        params: {
          adjuntoId: "22222222-2222-4222-8222-222222222222",
          id: "11111111-1111-4111-8111-111111111111",
        },
      } as never,
      response,
      next,
    );

    assert.equal(nextError, undefined);
    assert.equal(statusCode, 200);
    assert.deepEqual(responseBody, { id: "adjunto-1" });
    assert.deepEqual(receivedInput, {
      adicional: undefined,
      adjuntoId: "22222222-2222-4222-8222-222222222222",
      comentario: undefined,
      currentUser: {
        id: "admin-1",
        isSystemAdmin: true,
        workflowOwnerId: null,
      },
      descripcion: undefined,
      nroDocumento: undefined,
      restringido: undefined,
      solicitudId: "11111111-1111-4111-8111-111111111111",
      tipoAdjunto: undefined,
      updatedBy: "admin-1",
      workflowOwnerId: "",
    });
  });

  it("bypasses the workflow owner requirement and forwards isSystemAdmin when deleting an adjunto", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudAdjuntosController({
      deleteSolicitudAdjuntoUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return { id: "adjunto-1" };
        },
      } as never,
      downloadSolicitudAdjuntoUseCase: {} as never,
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
      listSolicitudAdjuntosUseCase: {} as never,
      updateSolicitudAdjuntoUseCase: {} as never,
      uploadSolicitudAdjuntoUseCase: {} as never,
      uploadSolicitudAdjuntosBatchUseCase: {} as never,
    });
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
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.delete(
      {
        body: {},
        cookies: {
          accessToken: "token",
        },
        params: {
          adjuntoId: "22222222-2222-4222-8222-222222222222",
          id: "11111111-1111-4111-8111-111111111111",
        },
      } as never,
      response,
      next,
    );

    assert.equal(nextError, undefined);
    assert.equal(statusCode, 200);
    assert.deepEqual(responseBody, { id: "adjunto-1" });
    assert.deepEqual(receivedInput, {
      adjuntoId: "22222222-2222-4222-8222-222222222222",
      currentUser: {
        id: "admin-1",
        isSystemAdmin: true,
        workflowOwnerId: null,
      },
      deleteReason: undefined,
      deletedBy: "admin-1",
      solicitudId: "11111111-1111-4111-8111-111111111111",
      workflowOwnerId: "",
    });
  });

  it("maps files and per-file metadata by index when uploading a batch", async () => {
    let receivedInput: unknown;
    const controller = new SolicitudAdjuntosController({
      deleteSolicitudAdjuntoUseCase: {} as never,
      downloadSolicitudAdjuntoUseCase: {} as never,
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
      listSolicitudAdjuntosUseCase: {} as never,
      updateSolicitudAdjuntoUseCase: {} as never,
      uploadSolicitudAdjuntoUseCase: {} as never,
      uploadSolicitudAdjuntosBatchUseCase: {
        execute: async (input: unknown) => {
          receivedInput = input;

          return [{ id: "adjunto-1" }, { id: "adjunto-2" }];
        },
      } as never,
    });
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
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.uploadBatch(
      {
        body: {
          metadata: JSON.stringify([
            { tipoAdjunto: "DNI" },
            { tipoAdjunto: "Documentación Adicional" },
          ]),
        },
        cookies: {
          accessToken: "token",
        },
        files: [
          {
            buffer: Buffer.from("dni"),
            mimetype: "application/pdf",
            originalname: "dni.pdf",
            size: 3,
          },
          {
            buffer: Buffer.from("firma"),
            mimetype: "application/pdf",
            originalname: "firma.pdf",
            size: 5,
          },
        ],
        params: {
          id: "11111111-1111-4111-8111-111111111111",
        },
      } as never,
      response,
      next,
    );

    assert.equal(nextError, undefined);
    assert.equal(statusCode, 201);
    assert.deepEqual(responseBody, [{ id: "adjunto-1" }, { id: "adjunto-2" }]);
    assert.deepEqual(
      (receivedInput as { files: { tipoAdjunto: string; file: { fileName: string } } [] }).files.map(
        (file) => ({ fileName: file.file.fileName, tipoAdjunto: file.tipoAdjunto }),
      ),
      [
        { fileName: "dni.pdf", tipoAdjunto: "DNI" },
        { fileName: "firma.pdf", tipoAdjunto: "Documentación Adicional" },
      ],
    );
  });

  it("returns the tipos adjunto catalog for an authenticated user", async () => {
    const controller = new SolicitudAdjuntosController({
      deleteSolicitudAdjuntoUseCase: {} as never,
      downloadSolicitudAdjuntoUseCase: {} as never,
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
      listSolicitudAdjuntosUseCase: {} as never,
      updateSolicitudAdjuntoUseCase: {} as never,
      uploadSolicitudAdjuntoUseCase: {} as never,
      uploadSolicitudAdjuntosBatchUseCase: {} as never,
    });
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
    let nextError: unknown;
    const next: NextFunction = (error?: unknown) => {
      nextError = error;
    };

    await controller.listTiposAdjunto(
      {
        cookies: {
          accessToken: "token",
        },
      } as never,
      response,
      next,
    );

    assert.equal(nextError, undefined);
    assert.equal(statusCode, 200);
    assert.deepEqual(responseBody, [
      { label: "DNI", value: "DNI" },
      { label: "Recibo de Sueldo", value: "Recibo de Sueldo" },
      { label: "Constancia de CBU", value: "Constancia de CBU" },
      { label: "Documentación Adicional", value: "Documentación Adicional" },
    ]);
  });
});
