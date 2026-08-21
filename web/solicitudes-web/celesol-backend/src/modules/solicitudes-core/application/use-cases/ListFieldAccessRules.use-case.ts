import type { ListFieldAccessRulesInput } from "../dtos/ListFieldAccessRules.dto";
import { resolveFieldAccessRuleRecord } from "../services/SolicitudFieldAccess";
import type { SolicitudFieldAccessAdminRepository } from "../../domain/repositories/SolicitudFieldAccessAdminRepository";

type Dependencies = {
  repository: SolicitudFieldAccessAdminRepository;
};

export class ListFieldAccessRulesUseCase {
  private readonly repository: SolicitudFieldAccessAdminRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  async execute(_input: ListFieldAccessRulesInput) {
    const states = await this.repository.findAllStates();
    const rules = await Promise.all(
      states.map(async (state) => {
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
      }),
    );

    return { rules };
  }
}
