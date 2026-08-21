import type {
  WorkflowTransitionAdminRecord,
  WorkflowTransitionAdminRepository,
  WorkflowTransitionAdminStateGroup,
  WorkflowTransitionAdminStateRecord,
  UpdateWorkflowTransitionMetadataInput,
} from "../../domain/repositories/WorkflowTransitionAdminRepository";
import type { WorkflowTransitionAdminPrismaDatasource } from "../datasources/WorkflowTransitionAdminPrismaDatasource";

type StateWithTransitions = Awaited<
  ReturnType<WorkflowTransitionAdminPrismaDatasource["findAllStatesWithTransitions"]>
>[number];

export class WorkflowTransitionAdminRepositoryImpl
  implements WorkflowTransitionAdminRepository
{
  private readonly datasource: WorkflowTransitionAdminPrismaDatasource;

  constructor(datasource: WorkflowTransitionAdminPrismaDatasource) {
    this.datasource = datasource;
  }

  async findAllStateGroups(): Promise<WorkflowTransitionAdminStateGroup[]> {
    const states = await this.datasource.findAllStatesWithTransitions();

    return states.map(mapStateGroup);
  }

  async findStateGroupByCode(
    stateCode: string,
  ): Promise<WorkflowTransitionAdminStateGroup | null> {
    const state = await this.datasource.findStateByCodeWithTransitions(stateCode);

    if (!state) {
      return null;
    }

    return mapStateGroup(state);
  }

  async updateTransitionMetadata(
    input: UpdateWorkflowTransitionMetadataInput,
  ): Promise<WorkflowTransitionAdminRecord> {
    const transition = await this.datasource.updateTransitionMetadata(input);

    return mapTransition(transition);
  }
}

function mapState(state: {
  code: string;
  id: string;
  name: string;
  owner: {
    code: string;
    id: string;
    name: string;
  };
}): WorkflowTransitionAdminStateRecord {
  return {
    code: state.code,
    id: state.id,
    name: state.name,
    owner: {
      code: state.owner.code,
      id: state.owner.id,
      name: state.owner.name,
    },
  };
}

function mapTransition(transition: {
  actionCode: string;
  actionLabel: string;
  defaultComment: string | null;
  description: string | null;
  id: string;
  isActive: boolean;
  requiresComment: boolean;
  sortOrder: number;
  toState: {
    code: string;
    id: string;
    name: string;
    owner: {
      code: string;
      id: string;
      name: string;
    };
  };
  updatedAt: Date;
}): WorkflowTransitionAdminRecord {
  return {
    actionCode: transition.actionCode,
    actionLabel: transition.actionLabel,
    defaultComment: transition.defaultComment,
    description: transition.description,
    id: transition.id,
    isActive: transition.isActive,
    requiresComment: transition.requiresComment,
    sortOrder: transition.sortOrder,
    toState: mapState(transition.toState),
    updatedAt: transition.updatedAt,
  };
}

function mapStateGroup(state: StateWithTransitions): WorkflowTransitionAdminStateGroup {
  return {
    fromState: mapState(state),
    transitions: state.outgoingTransitions.map(mapTransition),
  };
}
