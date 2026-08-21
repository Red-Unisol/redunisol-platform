import type { WorkflowStateCatalog } from "../../domain/services/WorkflowStateCatalog";
import type { WorkflowStatePrismaDatasource } from "../datasources/WorkflowStatePrismaDatasource";

export class PrismaWorkflowStateCatalog implements WorkflowStateCatalog {
  private readonly datasource: WorkflowStatePrismaDatasource;

  constructor(datasource: WorkflowStatePrismaDatasource) {
    this.datasource = datasource;
  }

  async getInitialState() {
    return this.datasource.findInitialState();
  }
}
