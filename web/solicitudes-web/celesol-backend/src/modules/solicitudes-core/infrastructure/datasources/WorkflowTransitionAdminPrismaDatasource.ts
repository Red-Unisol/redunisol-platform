import type { PrismaClient } from "@prisma/client";
import {
  WorkflowTransitionNotFoundError,
  WorkflowTransitionVersionConflictError,
} from "../../domain/solicitudes-core-errors";

type TransitionMetadataUpdateInput = {
  actionLabel: string;
  defaultComment: string | null;
  description: string | null;
  requiresComment: boolean;
  sortOrder: number;
  transitionId: string;
  updatedAt: string;
};

export class WorkflowTransitionAdminPrismaDatasource {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  findAllStatesWithTransitions() {
    return this.prisma.workflowState.findMany({
      where: {
        outgoingTransitions: {
          some: {},
        },
      },
      include: {
        owner: true,
        outgoingTransitions: {
          include: {
            toState: {
              include: {
                owner: true,
              },
            },
          },
          orderBy: [{ sortOrder: "asc" }, { actionLabel: "asc" }],
        },
      },
      orderBy: {
        code: "asc",
      },
    });
  }

  findStateByCodeWithTransitions(stateCode: string) {
    return this.prisma.workflowState.findUnique({
      where: {
        code: stateCode,
      },
      include: {
        owner: true,
        outgoingTransitions: {
          include: {
            toState: {
              include: {
                owner: true,
              },
            },
          },
          orderBy: [{ sortOrder: "asc" }, { actionLabel: "asc" }],
        },
      },
    });
  }

  async updateTransitionMetadata(input: TransitionMetadataUpdateInput) {
    const existingTransition = await this.prisma.workflowTransition.findUnique({
      where: {
        id: input.transitionId,
      },
    });

    if (!existingTransition) {
      throw new WorkflowTransitionNotFoundError();
    }

    const normalizedDescription = input.description?.trim()
      ? input.description.trim()
      : null;
    const normalizedDefaultComment = input.defaultComment?.trim()
      ? input.defaultComment.trim()
      : null;
    const expectedUpdatedAt = new Date(input.updatedAt);

    const updated = await this.prisma.workflowTransition.updateMany({
      where: {
        id: input.transitionId,
        updatedAt: expectedUpdatedAt,
      },
      data: {
        actionLabel: input.actionLabel.trim(),
        description: normalizedDescription,
        requiresComment: input.requiresComment,
        sortOrder: input.sortOrder,
        defaultComment: normalizedDefaultComment,
      },
    });

    if (updated.count === 0) {
      throw new WorkflowTransitionVersionConflictError();
    }

    return this.prisma.workflowTransition.findUniqueOrThrow({
      where: {
        id: input.transitionId,
      },
      include: {
        toState: {
          include: {
            owner: true,
          },
        },
      },
    });
  }
}
