import type { SolicitudEstadoHistorial } from "../entities/SolicitudEstadoHistorial.entity";
import type { WorkflowTransition } from "../entities/WorkflowTransition.entity";
import type {
  ExecuteSolicitudWorkflowPlanInput,
  ExecuteSolicitudWorkflowResult,
} from "../workflow/contracts";
export type {
  ExecuteSolicitudWorkflowPlanInput,
  ExecuteSolicitudWorkflowResult,
};

export type SolicitudTransitionValidationContext = {
  solicitud: {
    estadoActualId: string;
    ownerId: string | null;
  } | null;
  transition: {
    isActive: boolean;
    requiresComment: boolean;
    transitionId?: string | null;
    toStateCode?: string | null;
    toStateOwnerCode?: string | null;
    toStateId?: string | null;
    toStateIsActive: boolean;
  } | null;
};

export type SolicitudWorkflowRepository = {
  getTransitionValidationContext?(input: {
    actionCode: string;
    solicitudId: string;
  }): Promise<SolicitudTransitionValidationContext>;
  executeWorkflowPlan(
    input: ExecuteSolicitudWorkflowPlanInput,
  ): Promise<ExecuteSolicitudWorkflowResult>;
  listAvailableTransitions(input: {
    isSystemAdmin?: boolean;
    solicitudId: string;
    workflowOwnerId: string;
    workflowOwnerCode?: string | null;
  }): Promise<WorkflowTransition[]>;
  listHistory(input: {
    solicitudId: string;
    currentUser: {
      id: string;
      workflowOwnerId: string | null;
    };
  }): Promise<SolicitudEstadoHistorial[]>;
};
