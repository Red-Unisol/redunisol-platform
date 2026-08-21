import type { UpdateFieldAccessRuleInput } from "../dtos/UpdateFieldAccessRule.dto";
import {
  FieldAccessRuleStateNotFoundError,
  FieldAccessRuleVersionConflictError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudFieldAccessAdminRepository } from "../../domain/repositories/SolicitudFieldAccessAdminRepository";
import { resolveFieldAccessRuleRecord } from "../services/SolicitudFieldAccess";
import { normalizeFieldAccessRule } from "../services/SolicitudFieldAccessRuleValidation";

type Dependencies = {
  repository: SolicitudFieldAccessAdminRepository;
};

export class UpdateFieldAccessRuleUseCase {
  private readonly repository: SolicitudFieldAccessAdminRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  async execute(input: UpdateFieldAccessRuleInput) {
    const state = await this.repository.findStateByCode(input.stateCode);

    if (!state) {
      throw new FieldAccessRuleStateNotFoundError();
    }

    const existingRule = await this.repository.findRuleByWorkflowStateId(state.id);

    if (!existingRule && input.version !== 0) {
      throw new FieldAccessRuleVersionConflictError();
    }

    if (existingRule && existingRule.version !== input.version) {
      throw new FieldAccessRuleVersionConflictError();
    }

    const hasBackgroundColor = Object.prototype.hasOwnProperty.call(
      input,
      "backgroundColor",
    );
    const hasTextColor = Object.prototype.hasOwnProperty.call(
      input,
      "textColor",
    );

    const normalizedRule = normalizeFieldAccessRule({
      active: input.active,
      backgroundColor: hasBackgroundColor
        ? input.backgroundColor
        : existingRule?.backgroundColor ?? null,
      canManageAttachments: input.canManageAttachments,
      editableFields: input.editableFields,
      editableGroups: input.editableGroups,
      readonlyReason: input.readonlyReason,
      textColor: hasTextColor ? input.textColor : existingRule?.textColor ?? null,
    });

    const rule = await this.repository.saveRuleWithAudit({
      expectedVersion: input.version,
      nextRule: normalizedRule,
      updatedBy: input.currentUserId,
      workflowStateId: state.id,
    });

    const resolved = resolveFieldAccessRuleRecord(rule, {
      stateCode: state.code,
    });

    return {
      resolvedAppearance: resolved.appearance,
      resolvedFieldAccess: resolved.fieldAccess,
      rule,
      state: {
        code: state.code,
        id: state.id,
        name: state.name,
      },
    };
  }
}
