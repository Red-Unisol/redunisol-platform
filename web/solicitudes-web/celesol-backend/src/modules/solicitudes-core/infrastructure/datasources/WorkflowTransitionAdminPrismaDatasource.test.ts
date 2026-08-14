import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  WorkflowTransitionNotFoundError,
  WorkflowTransitionVersionConflictError,
} from "../../domain/solicitudes-core-errors";
import { WorkflowTransitionAdminPrismaDatasource } from "./WorkflowTransitionAdminPrismaDatasource";

describe("WorkflowTransitionAdminPrismaDatasource", () => {
  it("lists workflow states with outgoing transitions", async () => {
    const datasource = new WorkflowTransitionAdminPrismaDatasource(
      createPrismaClient() as never,
    );

    const result = await datasource.findAllStatesWithTransitions();

    assert.equal(result.length, 1);
    assert.equal(result[0]?.code, "CargaVendedor");
    assert.equal(result[0]?.outgoingTransitions[0]?.defaultComment, "Pase a riesgo");
  });

  it("updates only allowed transition metadata using normalized values", async () => {
    const prisma = createPrismaClient();
    const datasource = new WorkflowTransitionAdminPrismaDatasource(
      prisma as never,
    );

    const result = await datasource.updateTransitionMetadata({
      actionLabel: "  Enviar solicitud  ",
      defaultComment: "  Pase a riesgo  ",
      description: "   ",
      requiresComment: true,
      sortOrder: 25,
      transitionId: "tr-enviar",
      updatedAt: "2026-06-11T10:00:00.000Z",
    });

    assert.deepEqual(prisma.updateManyCalls[0], {
      data: {
        actionLabel: "Enviar solicitud",
        defaultComment: "Pase a riesgo",
        description: null,
        requiresComment: true,
        sortOrder: 25,
      },
      where: {
        id: "tr-enviar",
        updatedAt: new Date("2026-06-11T10:00:00.000Z"),
      },
    });
    assert.equal(result.actionLabel, "Enviar solicitud");
    assert.equal(result.defaultComment, "Pase a riesgo");
    assert.equal(result.description, null);
    assert.equal(result.requiresComment, true);
  });

  it("returns 404 when transition does not exist", async () => {
    const datasource = new WorkflowTransitionAdminPrismaDatasource(
      createPrismaClient({ withoutTransition: true }) as never,
    );

    await assert.rejects(
      () =>
        datasource.updateTransitionMetadata({
          actionLabel: "Enviar",
          defaultComment: null,
          description: null,
          requiresComment: false,
          sortOrder: 10,
          transitionId: "tr-missing",
          updatedAt: "2026-06-11T10:00:00.000Z",
        }),
      WorkflowTransitionNotFoundError,
    );
  });

  it("returns 409 on updatedAt conflict", async () => {
    const datasource = new WorkflowTransitionAdminPrismaDatasource(
      createPrismaClient({ conflict: true }) as never,
    );

    await assert.rejects(
      () =>
        datasource.updateTransitionMetadata({
          actionLabel: "Enviar",
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
});

function createPrismaClient(options?: {
  conflict?: boolean;
  withoutTransition?: boolean;
}) {
  const transition = {
    actionCode: "enviar",
    actionLabel: "Enviar",
    defaultComment: "Pase a riesgo",
    description: "Envia a riesgo",
    id: "tr-enviar",
    isActive: true,
    requiresComment: true,
    sortOrder: 10,
    toState: {
      code: "Motor",
      id: "state-motor",
      name: "Motor",
      owner: {
        code: "SISTEMA",
        id: "owner-sistema",
        name: "Sistema",
      },
    },
    updatedAt: new Date("2026-06-11T10:00:00.000Z"),
  };

  const updateManyCalls: Array<{
    data: unknown;
    where: unknown;
  }> = [];

  return {
    updateManyCalls,
    workflowState: {
      findMany: async () => [
        {
          code: "CargaVendedor",
          id: "state-carga",
          name: "CargaVendedor",
          owner: {
            code: "VENDEDORES",
            id: "owner-vendedores",
            name: "Vendedores",
          },
          outgoingTransitions: [transition],
        },
      ],
      findUnique: async ({ where }: { where: { code: string } }) =>
        where.code === "CargaVendedor"
          ? {
              code: "CargaVendedor",
              id: "state-carga",
              name: "CargaVendedor",
              owner: {
                code: "VENDEDORES",
                id: "owner-vendedores",
                name: "Vendedores",
              },
              outgoingTransitions: [transition],
            }
          : null,
    },
    workflowTransition: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        options?.withoutTransition || where.id !== transition.id ? null : transition,
      findUniqueOrThrow: async () => ({
        ...transition,
        actionLabel: "Enviar solicitud",
        defaultComment: "Pase a riesgo",
        description: null,
        requiresComment: true,
        sortOrder: 25,
      }),
      updateMany: async (args: { data: unknown; where: unknown }) => {
        updateManyCalls.push(args);
        return { count: options?.conflict ? 0 : 1 };
      },
    },
  };
}
