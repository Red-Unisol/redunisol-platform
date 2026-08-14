import type {
  PersistSolicitudFieldAccessRuleInput,
  SolicitudFieldAccessAdminRepository,
  SolicitudFieldAccessAdminRuleRecord,
  WorkflowStateAdminRecord,
} from "../../domain/repositories/SolicitudFieldAccessAdminRepository";
import type { SolicitudFieldAccessAdminPrismaDatasource } from "../datasources/SolicitudFieldAccessAdminPrismaDatasource";

export class SolicitudFieldAccessAdminRepositoryImpl
  implements SolicitudFieldAccessAdminRepository
{
  private readonly datasource: SolicitudFieldAccessAdminPrismaDatasource;

  constructor(datasource: SolicitudFieldAccessAdminPrismaDatasource) {
    this.datasource = datasource;
  }

  async findAllStates(): Promise<WorkflowStateAdminRecord[]> {
    const states = await this.datasource.findAllStates();

    return states.map((state) => ({
      code: state.code,
      id: state.id,
      isActive: state.isActive,
      isInitial: state.isInitial,
      isTerminal: state.isTerminal,
      name: state.name,
      ownerCode: state.owner.code,
      ownerId: state.ownerId,
      ownerName: state.owner.name,
    }));
  }

  async findStateByCode(stateCode: string): Promise<WorkflowStateAdminRecord | null> {
    const state = await this.datasource.findStateByCode(stateCode);

    if (!state) {
      return null;
    }

    return {
      code: state.code,
      id: state.id,
      isActive: state.isActive,
      isInitial: state.isInitial,
      isTerminal: state.isTerminal,
      name: state.name,
      ownerCode: state.owner.code,
      ownerId: state.ownerId,
      ownerName: state.owner.name,
    };
  }

  async findRuleByWorkflowStateId(
    workflowStateId: string,
  ): Promise<SolicitudFieldAccessAdminRuleRecord | null> {
    const rule = await this.datasource.findRuleByWorkflowStateId(workflowStateId);

    if (!rule) {
      return null;
    }

    return mapRuleRecord(rule);
  }

  async saveRuleWithAudit(
    input: PersistSolicitudFieldAccessRuleInput,
  ): Promise<SolicitudFieldAccessAdminRuleRecord> {
    const rule = await this.datasource.saveRuleWithAudit(input);

    return mapRuleRecord(rule);
  }
}

function mapRuleRecord(rule: {
  workflowStateId: string;
  backgroundColor: string | null;
  canManageAttachments: boolean;
  defaultMode: string;
  editableFields: string[];
  editableGroups: string[];
  readonlyReason: string | null;
  active: boolean;
  textColor: string | null;
  version: number;
  updatedAt: Date;
  updatedBy: string | null;
}): SolicitudFieldAccessAdminRuleRecord {
  return {
    active: rule.active,
    backgroundColor: rule.backgroundColor,
    canManageAttachments: rule.canManageAttachments,
    defaultMode: "readonly",
    editableFields: [...rule.editableFields],
    editableGroups: [...rule.editableGroups],
    readonlyReason: rule.readonlyReason,
    textColor: rule.textColor,
    updatedAt: rule.updatedAt,
    updatedBy: rule.updatedBy,
    version: rule.version,
    workflowStateId: rule.workflowStateId,
  };
}
