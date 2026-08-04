import type { GetFieldAccessRuleByStateInput } from "../dtos/GetFieldAccessRuleByState.dto";
import { resolveFieldAccessRuleRecord } from "../services/SolicitudFieldAccess";
import { FieldAccessRuleStateNotFoundError } from "../../domain/solicitudes-core-errors";
import type { SolicitudFieldAccessAdminRepository } from "../../domain/repositories/SolicitudFieldAccessAdminRepository";

type Dependencies = {
  repository: SolicitudFieldAccessAdminRepository;
};

export class GetFieldAccessRuleByStateUseCase {
  private readonly repository: SolicitudFieldAccessAdminRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  async execute(input: GetFieldAccessRuleByStateInput) {
    const state = await this.repository.findStateByCode(input.stateCode);

    if (!state) {
      throw new FieldAccessRuleStateNotFoundError();
    }

    const rule = await this.repository.findRuleByWorkflowStateId(state.id);
    const resolved = resolveFieldAccessRuleRecord(rule, {
      stateCode: state.code,
    });

    return {
      resolvedAppearance: resolved.appearance,
      resolvedFieldAccess: resolved.fieldAccess,
      rule,
      source: resolved.source,
      state,
    };
  }
}
