import type { SolicitudWorkflowRepository } from "../../domain/repositories/SolicitudWorkflowRepository";
import type { SolicitudWorkflowPrismaDatasource } from "../datasources/SolicitudWorkflowPrismaDatasource";

export class SolicitudWorkflowRepositoryImpl
  implements SolicitudWorkflowRepository
{
  private readonly datasource: SolicitudWorkflowPrismaDatasource;

  constructor(datasource: SolicitudWorkflowPrismaDatasource) {
    this.datasource = datasource;
  }

  executeWorkflowPlan(
    input: Parameters<SolicitudWorkflowRepository["executeWorkflowPlan"]>[0],
  ) {
    return this.datasource.executeWorkflowPlan(input);
  }

  getTransitionValidationContext(
    input: NonNullable<
      SolicitudWorkflowRepository["getTransitionValidationContext"]
    > extends (arg: infer T) => unknown
      ? T
      : never,
  ) {
    return this.datasource.getTransitionValidationContext(input);
  }

  listAvailableTransitions(
    input: Parameters<SolicitudWorkflowRepository["listAvailableTransitions"]>[0],
  ) {
    return this.datasource.listAvailableTransitions(input);
  }

  listHistory(
    input: Parameters<SolicitudWorkflowRepository["listHistory"]>[0],
  ) {
    return this.datasource.listHistory(input);
  }
}
