import type {
  SolicitudFieldAccessRuleRecord,
  SolicitudFieldAccessRulesRepository,
} from "../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type { SolicitudFieldAccessRulesPrismaDatasource } from "../datasources/SolicitudFieldAccessRulesPrismaDatasource";

export class SolicitudFieldAccessRulesRepositoryImpl
  implements SolicitudFieldAccessRulesRepository
{
  private readonly datasource: SolicitudFieldAccessRulesPrismaDatasource;

  constructor(datasource: SolicitudFieldAccessRulesPrismaDatasource) {
    this.datasource = datasource;
  }

  async findByWorkflowStateId(
    workflowStateId: string,
  ): Promise<SolicitudFieldAccessRuleRecord | null> {
    const record = await this.datasource.findByWorkflowStateId(workflowStateId);

    if (!record) {
      return null;
    }

    return {
      active: record.active,
      backgroundColor: record.backgroundColor,
      canManageAttachments: record.canManageAttachments,
      defaultMode: record.defaultMode === "readonly" ? "readonly" : "readonly",
      editableFields: [...record.editableFields],
      editableGroups: [...record.editableGroups],
      readonlyReason: record.readonlyReason,
      textColor: record.textColor,
      workflowStateId: record.workflowStateId,
    };
  }

  async findByWorkflowStateIds(
    workflowStateIds: string[],
  ): Promise<SolicitudFieldAccessRuleRecord[]> {
    const records = await this.datasource.findByWorkflowStateIds(
      workflowStateIds,
    );

    return records.map((record) => ({
      active: record.active,
      backgroundColor: record.backgroundColor,
      canManageAttachments: record.canManageAttachments,
      defaultMode: record.defaultMode === "readonly" ? "readonly" : "readonly",
      editableFields: [...record.editableFields],
      editableGroups: [...record.editableGroups],
      readonlyReason: record.readonlyReason,
      textColor: record.textColor,
      workflowStateId: record.workflowStateId,
    }));
  }
}
