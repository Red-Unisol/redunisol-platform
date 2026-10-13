import assert from "node:assert/strict";
import test from "node:test";
import { ChangeSolicitudStateUseCase } from "../solicitudes-core/application/use-cases/ChangeSolicitudState.use-case";
import type { SolicitudWorkflowEngine } from "../solicitudes-core/domain/workflow/SolicitudWorkflowEngine";
import type { SolicitudAdjuntoRepository } from "../solicitudes-core/adjuntos/domain/repositories/SolicitudAdjuntoRepository";
import type { SolicitudesCoreRepository } from "../solicitudes-core/domain/repositories/SolicitudesCoreRepository";
import type { SocioRepository } from "../socios/domain/repositories/SocioRepository";
import { DocumentReviewError } from "./domain";
import { documentReviewConfigSchema } from "./config";

test("normal workflow route cannot bypass the configured human-decision gate, even as administrator", async () => {
  let called = false;
  const useCase = new ChangeSolicitudStateUseCase({
    adjuntoRepository: {} as SolicitudAdjuntoRepository,
    solicitudesRepository: {} as SolicitudesCoreRepository,
    sociosRepository: {} as SocioRepository,
    now: () => new Date(),
    engine: {
      execute: async () => {
        called = true;
        throw new Error("Must not run");
      },
    } as unknown as SolicitudWorkflowEngine,
    authorizeDocumentReview: async () => {
      throw new DocumentReviewError("Human decision required");
    },
  });
  for (const actionCode of ["transferir", "devolver_a_liquidada"]) {
    await assert.rejects(
      () =>
        useCase.execute({
          actionCode,
          solicitudId: "test",
          currentUser: {
            id: "test",
            workflowOwnerId: "test",
            isSystemAdmin: true,
          },
        }),
      /Human decision required/,
    );
  }
  assert.equal(called, false);
});
test("enabled configuration requires all accesses and HTTPS; disabled remains backward-compatible", () => {
  const empty = {
    enabled: false,
    serverBaseUrl: "",
    serverClientId: "",
    serverClientSecret: "",
    clientId: "",
    clientSecret: "",
  };
  assert(documentReviewConfigSchema.safeParse(empty).success);
  assert(
    !documentReviewConfigSchema.safeParse({ ...empty, enabled: true }).success,
  );
  assert(
    documentReviewConfigSchema.safeParse({
      enabled: true,
      serverBaseUrl: "https://metamap.example.invalid",
      serverClientId: "test",
      serverClientSecret: "test",
      clientId: "test",
      clientSecret: "test",
    }).success,
  );
});
