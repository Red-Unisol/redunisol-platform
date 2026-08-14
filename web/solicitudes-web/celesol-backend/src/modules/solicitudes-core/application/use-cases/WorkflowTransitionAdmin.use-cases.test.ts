import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  WorkflowTransitionAdminRecord,
  WorkflowTransitionAdminRepository,
  WorkflowTransitionAdminStateGroup,
} from "../../domain/repositories/WorkflowTransitionAdminRepository";
import {
  WorkflowTransitionStateNotFoundError,
  WorkflowTransitionVersionConflictError,
} from "../../domain/solicitudes-core-errors";
import { GetWorkflowTransitionsByStateUseCase } from "./GetWorkflowTransitionsByState.use-case";
import { ListWorkflowTransitionsUseCase } from "./ListWorkflowTransitions.use-case";
import { UpdateWorkflowTransitionMetadataUseCase } from "./UpdateWorkflowTransitionMetadata.use-case";

describe("WorkflowTransition admin use cases", () => {
  it("lists transitions grouped by fromState", async () => {
    const repository = createRepository();
    const useCase = new ListWorkflowTransitionsUseCase({ repository });

    const result = await useCase.execute({ currentUserId: "admin-1" });

    assert.equal(result.states.length, 2);
    assert.equal(result.states[0]?.fromState.code, "CargaVendedor");
    assert.equal(result.states[0]?.transitions[0]?.actionCode, "enviar");
  });

  it("returns one state group by state code", async () => {
    const repository = createRepository();
    const useCase = new GetWorkflowTransitionsByStateUseCase({ repository });

    const result = await useCase.execute({
      currentUserId: "admin-1",
      stateCode: "CargaVendedor",
    });

    assert.equal(result.fromState.code, "CargaVendedor");
    assert.equal(result.transitions.length, 2);
  });

  it("returns 404 when state code does not exist", async () => {
    const repository = createRepository();
    const useCase = new GetWorkflowTransitionsByStateUseCase({ repository });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUserId: "admin-1",
          stateCode: "NoExiste",
        }),
      WorkflowTransitionStateNotFoundError,
    );
  });

  it("updates only safe metadata", async () => {
    const repository = createRepository();
    const useCase = new UpdateWorkflowTransitionMetadataUseCase({ repository });

    const result = await useCase.execute({
      actionLabel: "  Enviar solicitud  ",
      currentUserId: "admin-1",
      defaultComment: "  Pase a riesgo  ",
      description: "  Descripcion ajustada  ",
      requiresComment: true,
      sortOrder: 20,
      transitionId: "tr-enviar",
      updatedAt: "2026-06-11T10:00:00.000Z",
    });

    assert.equal(result.actionLabel, "Enviar solicitud");
    assert.equal(result.description, "Descripcion ajustada");
    assert.equal(result.defaultComment, "Pase a riesgo");
    assert.equal(result.requiresComment, true);
    assert.equal(result.sortOrder, 20);
    assert.equal(result.isActive, true);
    assert.equal(result.toState.code, "Motor");
  });

  it("returns 409 on optimistic conflict", async () => {
    const repository = createRepository({ failConflict: true });
    const useCase = new UpdateWorkflowTransitionMetadataUseCase({ repository });

    await assert.rejects(
      () =>
        useCase.execute({
          actionLabel: "Enviar",
          currentUserId: "admin-1",
          defaultComment: null,
          description: null,
          requiresComment: false,
          sortOrder: 10,
          transitionId: "tr-enviar",
          updatedAt: "2026-06-11T10:00:00.000Z",
        }),
      WorkflowTransitionVersionConflictError,
    );
  });

  it("persists requiresComment changes independently from the structural catalog", async () => {
    const repository = createRepository();
    const updateUseCase = new UpdateWorkflowTransitionMetadataUseCase({ repository });
    const getUseCase = new GetWorkflowTransitionsByStateUseCase({ repository });

    await updateUseCase.execute({
      actionLabel: "Enviar",
      currentUserId: "admin-1",
      defaultComment: "Pase a riesgo",
      description: null,
      requiresComment: true,
      sortOrder: 10,
      transitionId: "tr-enviar",
      updatedAt: "2026-06-11T10:00:00.000Z",
    });

    let updatedState = await getUseCase.execute({
      currentUserId: "admin-1",
      stateCode: "CargaVendedor",
    });
    assert.equal(updatedState.transitions[0]?.requiresComment, true);

    await updateUseCase.execute({
      actionLabel: "Enviar",
      currentUserId: "admin-1",
      defaultComment: "Pase a riesgo",
      description: null,
      requiresComment: false,
      sortOrder: 10,
      transitionId: "tr-enviar",
      updatedAt: "2026-06-11T11:00:00.000Z",
    });

    updatedState = await getUseCase.execute({
      currentUserId: "admin-1",
      stateCode: "CargaVendedor",
    });
    assert.equal(updatedState.transitions[0]?.requiresComment, false);
    assert.equal(updatedState.transitions[0]?.actionCode, "enviar");
    assert.equal(updatedState.transitions[0]?.toState.code, "Motor");
  });
});

function createRepository(options?: { failConflict?: boolean }) {
  const groups = new Map<string, WorkflowTransitionAdminStateGroup>([
    [
      "CargaVendedor",
      {
        fromState: state("state-carga", "CargaVendedor", "Vendedores"),
        transitions: [
          transition("tr-enviar", {
            actionCode: "enviar",
            actionLabel: "Enviar",
            defaultComment: "Pase a riesgo",
            description: "Envia a riesgo",
            sortOrder: 10,
            toState: state("state-motor", "Motor", "Sistema"),
          }),
          transition("tr-desestimar", {
            actionCode: "desestimar",
            actionLabel: "Desestimar",
            description: "Descarta la solicitud",
            requiresComment: true,
            sortOrder: 20,
            toState: state("state-desestimada", "Desestimada", "Historial"),
          }),
        ],
      },
    ],
    [
      "RevisionRiesgo",
      {
        fromState: state("state-riesgo", "RevisionRiesgo", "Riesgo"),
        transitions: [
          transition("tr-confirmar", {
            actionCode: "confirmar",
            actionLabel: "Confirmar",
            sortOrder: 10,
            toState: state("state-confirmada", "Confirmada", "Riesgo"),
          }),
        ],
      },
    ],
  ]);

  const repository: WorkflowTransitionAdminRepository = {
    findAllStateGroups: async () =>
      Array.from(groups.values()).map((group) => cloneGroup(group)!),
    findStateGroupByCode: async (stateCode) => cloneGroup(groups.get(stateCode) ?? null),
    updateTransitionMetadata: async (input) => {
      if (options?.failConflict) {
        throw new WorkflowTransitionVersionConflictError();
      }

      for (const [stateCode, group] of groups) {
        const index = group.transitions.findIndex(
          (transitionItem) => transitionItem.id === input.transitionId,
        );

        if (index === -1) {
          continue;
        }

        const current = group.transitions[index]!;
        const next: WorkflowTransitionAdminRecord = {
          ...current,
          actionLabel: input.actionLabel.trim(),
          defaultComment: input.defaultComment?.trim()
            ? input.defaultComment.trim()
            : null,
          description: input.description?.trim()
            ? input.description.trim()
            : null,
          requiresComment: input.requiresComment,
          sortOrder: input.sortOrder,
          updatedAt: new Date("2026-06-11T11:00:00.000Z"),
        };

        group.transitions[index] = next;
        groups.set(stateCode, group);
        return { ...next };
      }

      throw new WorkflowTransitionVersionConflictError();
    },
  };

  return repository;
}

function state(id: string, code: string, ownerName: string) {
  return {
    code,
    id,
    name: code,
    owner: {
      code: ownerName.toUpperCase(),
      id: `owner-${ownerName.toLowerCase()}`,
      name: ownerName,
    },
  };
}

function transition(
  id: string,
  overrides?: Partial<WorkflowTransitionAdminRecord>,
): WorkflowTransitionAdminRecord {
  return {
    actionCode: "enviar",
    actionLabel: "Enviar",
    defaultComment: null,
    description: null,
    id,
    isActive: true,
    requiresComment: false,
    sortOrder: 10,
    toState: state("state-motor", "Motor", "Sistema"),
    updatedAt: new Date("2026-06-11T10:00:00.000Z"),
    ...overrides,
  };
}

function cloneGroup(group: WorkflowTransitionAdminStateGroup | null) {
  if (!group) {
    return null;
  }

  return {
    fromState: {
      ...group.fromState,
      owner: { ...group.fromState.owner },
    },
    transitions: group.transitions.map((transitionItem) => ({
      ...transitionItem,
      toState: {
        ...transitionItem.toState,
        owner: { ...transitionItem.toState.owner },
      },
      updatedAt: new Date(transitionItem.updatedAt),
    })),
  };
}
