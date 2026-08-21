import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SolicitudWorkflowRepository } from "../../domain/repositories/SolicitudWorkflowRepository";
import { ListSolicitudHistoryUseCase } from "./ListSolicitudHistory.use-case";

describe("ListSolicitudHistoryUseCase", () => {
  it("delegates solicitud id and workflow owner to the repository", async () => {
    let received:
      | Parameters<SolicitudWorkflowRepository["listHistory"]>[0]
      | null = null;
    const repository: SolicitudWorkflowRepository = {
      executeWorkflowPlan: async () => {
        throw new Error("not used");
      },
      listAvailableTransitions: async () => [],
      listHistory: async (input) => {
        received = input;

        return [];
      },
    };
    const useCase = new ListSolicitudHistoryUseCase({ repository });

    await useCase.execute({
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      solicitudId: "sol-1",
    });

    assert.deepEqual(received, {
      currentUser: {
        id: "user-1",
        workflowOwnerId: "owner-1",
      },
      solicitudId: "sol-1",
    });
  });
});
