import { Prisma, type PrismaClient } from "@prisma/client";
import { FieldAccessRuleVersionConflictError } from "../../domain/solicitudes-core-errors";

type PersistRuleInput = {
  workflowStateId: string;
  expectedVersion: number;
  nextRule: {
    defaultMode: "readonly";
    editableFields: string[];
    editableGroups: string[];
    canManageAttachments: boolean;
    readonlyReason: string | null;
    backgroundColor: string | null;
    textColor: string | null;
    active: boolean;
  };
  updatedBy: string;
};

export class SolicitudFieldAccessAdminPrismaDatasource {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  findAllStates() {
    return this.prisma.workflowState.findMany({
      include: {
        owner: {
          select: {
            code: true,
            name: true,
          },
        },
      },
      orderBy: {
        code: "asc",
      },
    });
  }

  findStateByCode(stateCode: string) {
    return this.prisma.workflowState.findUnique({
      where: {
        code: stateCode,
      },
      include: {
        owner: {
          select: {
            code: true,
            name: true,
          },
        },
      },
    });
  }

  findRuleByWorkflowStateId(workflowStateId: string) {
    return this.prisma.solicitudFieldAccessRule.findUnique({
      where: {
        workflowStateId,
      },
    });
  }

  async saveRuleWithAudit(input: PersistRuleInput) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existingRule = await tx.solicitudFieldAccessRule.findUnique({
          where: {
            workflowStateId: input.workflowStateId,
          },
        });
        const state = await tx.workflowState.findUnique({
          where: {
            id: input.workflowStateId,
          },
        });

        if (!state) {
          throw new FieldAccessRuleVersionConflictError();
        }

        const previousValue = existingRule
          ? buildRuleSnapshot({
              active: existingRule.active,
              backgroundColor: existingRule.backgroundColor,
              canManageAttachments: existingRule.canManageAttachments,
              defaultMode: existingRule.defaultMode,
              editableFields: existingRule.editableFields,
              editableGroups: existingRule.editableGroups,
              readonlyReason: existingRule.readonlyReason,
              textColor: existingRule.textColor,
              version: existingRule.version,
            })
          : null;

        if (!existingRule) {
          if (input.expectedVersion !== 0) {
            throw new FieldAccessRuleVersionConflictError();
          }

          const createdRule = await tx.solicitudFieldAccessRule.create({
            data: {
              active: input.nextRule.active,
              backgroundColor: input.nextRule.backgroundColor,
              canManageAttachments: input.nextRule.canManageAttachments,
              defaultMode: "readonly",
              editableFields: input.nextRule.editableFields,
              editableGroups: input.nextRule.editableGroups,
              readonlyReason: input.nextRule.readonlyReason,
              textColor: input.nextRule.textColor,
              updatedBy: input.updatedBy,
              version: 1,
              workflowStateId: input.workflowStateId,
            },
          });

          await tx.solicitudFieldAccessRuleAudit.create({
            data: {
              changedBy: input.updatedBy,
              eventType: "UPDATE",
              nextValue: buildRuleSnapshot({
                active: createdRule.active,
                backgroundColor: createdRule.backgroundColor,
                canManageAttachments: createdRule.canManageAttachments,
                defaultMode: createdRule.defaultMode,
                editableFields: createdRule.editableFields,
                editableGroups: createdRule.editableGroups,
                readonlyReason: createdRule.readonlyReason,
                textColor: createdRule.textColor,
                version: createdRule.version,
              }),
              previousValue: previousValue ?? Prisma.JsonNull,
              stateCodeSnapshot: state.code,
              stateNameSnapshot: state.name,
              version: createdRule.version,
              workflowStateId: input.workflowStateId,
            },
          });

          return createdRule;
        }

        const nextVersion = existingRule.version + 1;
        const updatedCount = await tx.solicitudFieldAccessRule.updateMany({
          data: {
            active: input.nextRule.active,
            backgroundColor: input.nextRule.backgroundColor,
            canManageAttachments: input.nextRule.canManageAttachments,
            defaultMode: "readonly",
            editableFields: input.nextRule.editableFields,
            editableGroups: input.nextRule.editableGroups,
            readonlyReason: input.nextRule.readonlyReason,
            textColor: input.nextRule.textColor,
            updatedBy: input.updatedBy,
            version: nextVersion,
          },
          where: {
            version: input.expectedVersion,
            workflowStateId: input.workflowStateId,
          },
        });

        if (updatedCount.count === 0) {
          throw new FieldAccessRuleVersionConflictError();
        }

        const updatedRule = await tx.solicitudFieldAccessRule.findUniqueOrThrow({
          where: {
            workflowStateId: input.workflowStateId,
          },
        });

        await tx.solicitudFieldAccessRuleAudit.create({
          data: {
            changedBy: input.updatedBy,
            eventType: "UPDATE",
            nextValue: buildRuleSnapshot({
              active: updatedRule.active,
              backgroundColor: updatedRule.backgroundColor,
              canManageAttachments: updatedRule.canManageAttachments,
              defaultMode: updatedRule.defaultMode,
              editableFields: updatedRule.editableFields,
              editableGroups: updatedRule.editableGroups,
              readonlyReason: updatedRule.readonlyReason,
              textColor: updatedRule.textColor,
              version: updatedRule.version,
            }),
            previousValue: previousValue ?? Prisma.JsonNull,
            stateCodeSnapshot: state.code,
            stateNameSnapshot: state.name,
            version: updatedRule.version,
            workflowStateId: input.workflowStateId,
          },
        });

        return updatedRule;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new FieldAccessRuleVersionConflictError();
      }

      throw error;
    }
  }
}

function buildRuleSnapshot(rule: {
  active: boolean;
  backgroundColor: string | null;
  canManageAttachments: boolean;
  defaultMode: string;
  editableFields: string[];
  editableGroups: string[];
  readonlyReason: string | null;
  textColor: string | null;
  version: number;
}) {
  return {
    active: rule.active,
    backgroundColor: rule.backgroundColor,
    canManageAttachments: rule.canManageAttachments,
    defaultMode: rule.defaultMode,
    editableFields: rule.editableFields,
    editableGroups: rule.editableGroups,
    readonlyReason: rule.readonlyReason,
    textColor: rule.textColor,
    version: rule.version,
  };
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as Prisma.PrismaClientKnownRequestError).code === "P2002"
  );
}
