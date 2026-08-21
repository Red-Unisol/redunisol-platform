import type { DbClient } from "../../../../db/prisma";

export class WorkflowStatePrismaDatasource {
  private readonly prisma: DbClient;

  constructor(prisma: DbClient) {
    this.prisma = prisma;
  }

  findInitialState() {
    return this.prisma.workflowState.findFirst({
      where: {
        isActive: true,
        isInitial: true,
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        code: true,
        id: true,
        name: true,
      },
    });
  }
}
