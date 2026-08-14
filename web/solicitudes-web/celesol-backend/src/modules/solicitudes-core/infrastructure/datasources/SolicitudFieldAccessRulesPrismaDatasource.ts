import type { PrismaClient } from "@prisma/client";

export class SolicitudFieldAccessRulesPrismaDatasource {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  findByWorkflowStateId(workflowStateId: string) {
    return this.prisma.solicitudFieldAccessRule.findUnique({
      where: {
        workflowStateId,
      },
      select: {
        active: true,
        backgroundColor: true,
        canManageAttachments: true,
        defaultMode: true,
        editableFields: true,
        editableGroups: true,
        readonlyReason: true,
        textColor: true,
        workflowStateId: true,
      },
    });
  }

  findByWorkflowStateIds(workflowStateIds: string[]) {
    if (workflowStateIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.solicitudFieldAccessRule.findMany({
      where: {
        workflowStateId: {
          in: workflowStateIds,
        },
      },
      select: {
        active: true,
        backgroundColor: true,
        canManageAttachments: true,
        defaultMode: true,
        editableFields: true,
        editableGroups: true,
        readonlyReason: true,
        textColor: true,
        workflowStateId: true,
      },
    });
  }
}
