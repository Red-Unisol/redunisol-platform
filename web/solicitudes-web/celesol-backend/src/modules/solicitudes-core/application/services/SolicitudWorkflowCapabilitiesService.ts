import type { WorkflowExecutionResult } from "../../domain/workflow/types";

export class SolicitudWorkflowCapabilitiesService {
  decorate(result: WorkflowExecutionResult): WorkflowExecutionResult {
    return result;
  }
}
