import type { UpdateWorkflowTransitionMetadataInput } from "../dtos/UpdateWorkflowTransitionMetadata.dto";
import type { WorkflowTransitionAdminRepository } from "../../domain/repositories/WorkflowTransitionAdminRepository";

type Dependencies = {
  repository: WorkflowTransitionAdminRepository;
};

export class UpdateWorkflowTransitionMetadataUseCase {
  private readonly repository: WorkflowTransitionAdminRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  execute(input: UpdateWorkflowTransitionMetadataInput) {
    return this.repository.updateTransitionMetadata({
      actionLabel: input.actionLabel,
      defaultComment: input.defaultComment,
      description: input.description,
      requiresComment: input.requiresComment,
      sortOrder: input.sortOrder,
      transitionId: input.transitionId,
      updatedAt: input.updatedAt,
      updatedBy: input.currentUserId,
    });
  }
}
