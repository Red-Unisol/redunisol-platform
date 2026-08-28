import type { Prisma } from "@prisma/client";

import type { DbClient } from "../../../../db/prisma";
import type {
  ExecuteSolicitudWorkflowPlanInput,
  SolicitudWorkflowRepository,
} from "../../domain/repositories/SolicitudWorkflowRepository";
import { getWorkflowPlanExecutabilityIssues } from "../../domain/workflow/contracts";
import { canEditSolicitud } from "../../application/services/SolicitudPermissions";
import {
  ForbiddenSolicitudAccessError,
  MissingWorkflowOwnerAssignmentError,
  SolicitudCoreNotFoundError,
  SolicitudWorkflowDestinationInactiveError,
  SolicitudWorkflowTransitionNotAllowedError,
  WorkflowExecutionPlanNotExecutableError,
  WorkflowExecutionPlanStateConflictError,
} from "../../domain/solicitudes-core-errors";
import { SolicitudCoreMapper } from "../mappers/SolicitudCore.mapper";

const solicitudCoreInclude = {
  assignedToUser: {
    select: {
      email: true,
      firstName: true,
      id: true,
      lastName: true,
    },
  },
  conyuge: true,
  datosLaborales: true,
  estadoActual: true,
  garantias: true,
  titular: true,
} satisfies Prisma.SolicitudInclude;

const solicitudWithOwnerInclude = {
  estadoActual: {
    include: {
      owner: true,
    },
  },
  participants: {
    select: {
      userId: true,
    },
  },
} satisfies Prisma.SolicitudInclude;

const transitionInclude = {
  toState: {
    include: {
      owner: true,
    },
  },
} satisfies Prisma.WorkflowTransitionInclude;

type WorkflowExecutor = Pick<
  DbClient,
  | "solicitud"
  | "solicitudEstadoHistorial"
  | "workflowTransition"
  | "user"
  | "workflowAssignmentCursor"
  | "$queryRaw"
>;

type SolicitudWithOwner = Prisma.SolicitudGetPayload<{
  include: typeof solicitudWithOwnerInclude;
}>;

type WorkflowTransitionWithToState = Prisma.WorkflowTransitionGetPayload<{
  include: typeof transitionInclude;
}>;

const historyInclude = {
  changedByUser: {
    select: {
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.SolicitudEstadoHistorialInclude;

type SolicitudHistoryRecord = Prisma.SolicitudEstadoHistorialGetPayload<{
  include: typeof historyInclude;
}>;

export class SolicitudWorkflowPrismaDatasource {
  private readonly prisma: DbClient;

  constructor(prisma: DbClient) {
    this.prisma = prisma;
  }

  async getTransitionValidationContext(input: {
    actionCode: string;
    solicitudId: string;
  }) {
    const solicitud = await this.prisma.solicitud.findUnique({
      where: {
        id: input.solicitudId,
      },
      include: solicitudWithOwnerInclude,
    });

    if (!solicitud) {
      return {
        solicitud: null,
        transition: null,
      };
    }

    const transition = await this.prisma.workflowTransition.findFirst({
      where: {
        actionCode: input.actionCode,
        fromStateId: solicitud.estadoActualId,
      },
      include: transitionInclude,
    });

    return {
      solicitud: {
        estadoActualId: solicitud.estadoActualId,
        ownerId: solicitud.estadoActual.ownerId,
      },
      transition: transition
        ? {
            isActive: transition.isActive,
            requiresComment: transition.requiresComment,
            transitionId: transition.id,
            toStateCode: transition.toState.code,
            toStateOwnerCode: transition.toState.owner.code,
            toStateId: transition.toStateId,
            toStateIsActive: transition.toState.isActive,
          }
        : null,
    };
  }

  async executeWorkflowPlan(input: ExecuteSolicitudWorkflowPlanInput) {
    const issues = getWorkflowPlanExecutabilityIssues(input.plan).filter(
      (issue) => issue !== "domain_from_state_mismatch",
    );
    if (issues.length > 0) {
      throw new WorkflowExecutionPlanNotExecutableError(issues);
    }

    this.logWorkflowEvent("workflow_plan_execution_started", {
      expectedStateFromStateId: input.plan.expectedState.fromStateId,
      solicitudId: input.plan.command.solicitudId,
      stepsCount: input.plan.steps.length,
    });

    let currentStepIndex: number | null = null;
    let currentStepKind:
      | "domain-transition"
      | "technical-transition"
      | "auto-assignment"
      | null = null;
    let currentStepActionCode: string | null = null;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const executor = tx as WorkflowExecutor;
        const domainSteps = input.plan.steps.filter(
          (step) => step.kind === "domain-transition",
        );

        let solicitud = await this.loadSolicitudForWorkflow(
          executor,
          input.plan.command.solicitudId,
        );
        if (solicitud.estadoActualId !== input.plan.expectedState.fromStateId) {
          this.logWorkflowEvent("workflow_plan_state_conflict", {
            currentStateId: solicitud.estadoActualId,
            expectedStateFromStateId: input.plan.expectedState.fromStateId,
            scope: "initial",
            solicitudId: input.plan.command.solicitudId,
          });
          throw new WorkflowExecutionPlanStateConflictError();
        }
        let updatedSolicitud = await this.loadSolicitudCoreById(
          executor,
          solicitud.id,
        );
        let finalStateId = solicitud.estadoActualId;

        for (const [stepIndex, step] of input.plan.steps.entries()) {
          currentStepIndex = stepIndex;
          currentStepKind = step.kind;
          currentStepActionCode = step.actionCode;

          // El paso de reparto no es una transicion: no mueve el estado ni
          // valida from/to. Se resuelve aparte y sigue con el proximo step.
          if (step.kind === "auto-assignment") {
            this.logWorkflowEvent("workflow_plan_step_started", {
              stepActionCode: step.actionCode,
              stepIndex,
              stepKind: step.kind,
              solicitudId: input.plan.command.solicitudId,
            });

            const assigned = await this.applyAutoAssignment({
              actorUserId: input.plan.command.changedBy,
              executor,
              solicitudId: input.plan.command.solicitudId,
            });

            if (assigned) {
              updatedSolicitud = assigned;
            }

            this.logWorkflowEvent("workflow_plan_step_completed", {
              assignedToUserId: assigned?.assignedToUserId ?? null,
              stepActionCode: step.actionCode,
              stepIndex,
              stepKind: step.kind,
              solicitudId: input.plan.command.solicitudId,
            });

            continue;
          }

          this.logWorkflowEvent("workflow_plan_step_started", {
            expectedFromStateId: step.fromStateId,
            expectedToStateId: step.toStateId ?? null,
            stepActionCode: step.actionCode,
            stepIndex,
            stepKind: step.kind,
            solicitudId: input.plan.command.solicitudId,
          });

          if (solicitud.estadoActualId !== step.fromStateId) {
            this.logWorkflowEvent("workflow_plan_state_conflict", {
              currentStateId: solicitud.estadoActualId,
              expectedFromStateId: step.fromStateId,
              scope: "step",
              solicitudId: input.plan.command.solicitudId,
              stepActionCode: step.actionCode,
              stepIndex,
              stepKind: step.kind,
            });
            throw new WorkflowExecutionPlanStateConflictError();
          }

          const transition = await executor.workflowTransition.findFirst({
            where: {
              actionCode: step.actionCode,
              fromStateId: solicitud.estadoActualId,
              isActive: true,
            },
            include: transitionInclude,
          });

          if (!transition) {
            throw new SolicitudWorkflowTransitionNotAllowedError();
          }

          if (step.transitionId && transition.id !== step.transitionId) {
            throw new SolicitudWorkflowTransitionNotAllowedError();
          }

          if (step.toStateId && transition.toStateId !== step.toStateId) {
            throw new SolicitudWorkflowTransitionNotAllowedError();
          }

          if (!transition.toState.isActive) {
            throw new SolicitudWorkflowDestinationInactiveError();
          }

          if (step.kind === "domain-transition") {
            updatedSolicitud = await this.applyTransition({
              changedBy: step.transitionInput.changedBy,
              comentario: step.transitionInput.comment?.trim() || null,
              executor,
              motivo: step.transitionInput.motivo?.trim() || null,
              now: step.transitionInput.now,
              solicitud,
              transition,
            });
          } else {
            updatedSolicitud = await this.applyTransition({
              changedBy: input.plan.command.changedBy,
              comentario: null,
              executor,
              motivo: null,
              now: input.plan.command.now,
              solicitud,
              transition,
            });
          }

          finalStateId = transition.toStateId;
          this.logWorkflowEvent("workflow_plan_step_completed", {
            persistedToStateId: transition.toStateId,
            stepActionCode: step.actionCode,
            stepIndex,
            stepKind: step.kind,
            solicitudId: input.plan.command.solicitudId,
          });

          if (step !== input.plan.steps[input.plan.steps.length - 1]) {
            solicitud = await this.loadSolicitudForWorkflow(
              executor,
              input.plan.command.solicitudId,
            );
          }
        }

        // Defensive check: an executable plan must always include one domain step.
        if (domainSteps.length === 0) {
          throw new WorkflowExecutionPlanNotExecutableError(["missing_domain_step"]);
        }

        const transitions = await this.loadActiveTransitions(executor, finalStateId);

        return {
          solicitud: SolicitudCoreMapper.toDomain(updatedSolicitud),
          transitions,
        };
      });

      this.logWorkflowEvent("workflow_plan_execution_completed", {
        finalStateId: result.solicitud.estadoActual.id,
        solicitudId: input.plan.command.solicitudId,
        stepsCount: input.plan.steps.length,
      });

      return result;
    } catch (error) {
      this.logWorkflowEvent(
        "workflow_plan_execution_failed",
        {
          solicitudId: input.plan.command.solicitudId,
          stepActionCode: currentStepActionCode,
          stepIndex: currentStepIndex,
          stepKind: currentStepKind,
          stepsCount: input.plan.steps.length,
        },
        "error",
      );
      throw error;
    }
  }

  private logWorkflowEvent(
    event: string,
    details: Record<string, unknown>,
    level: "info" | "error" = "info",
  ) {
    if (level === "error") {
      console.error(event, details);
      return;
    }

    console.info(event, details);
  }

  private async loadSolicitudCoreById(executor: WorkflowExecutor, solicitudId: string) {
    const solicitud = await executor.solicitud.findUnique({
      where: {
        id: solicitudId,
      },
      include: solicitudCoreInclude,
    });

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    return solicitud;
  }

  private shouldAutoChainMotorTransition(transition: WorkflowTransitionWithToState) {
    return transition.toState.code === "Motor";
  }

  // Reparto por turno (round-robin) al entrar a un owner que asigna solo.
  // Best-effort a proposito: si no hay candidatos habilitados o falta la fila
  // de cursor, la solicitud sigue su curso sin asignar y queda en el tablero
  // de "requieren ejecutivo". Un problema de reparto no debe abortar el envio
  // del vendedor, que es quien menos control tiene sobre esto.
  private async applyAutoAssignment(input: {
    actorUserId: string;
    executor: WorkflowExecutor;
    solicitudId: string;
  }) {
    const solicitud = await input.executor.solicitud.findUnique({
      where: {
        id: input.solicitudId,
      },
      include: solicitudWithOwnerInclude,
    });

    // Reenvio desde Revisar o PreAprobada: si ya tiene ejecutivo se respeta.
    // El analista que la vio antes la sigue viendo.
    if (!solicitud || solicitud.assignedToUserId) {
      return null;
    }

    // El owner sale del estado en que la solicitud quedo despues de los steps
    // anteriores, no de lo que declaro el plan: si el estado final cambia, el
    // reparto sigue al estado real.
    const ownerId = solicitud.estadoActual.ownerId;

    if (!ownerId) {
      return null;
    }

    // Bloqueo de la fila del cursor. Serializa dos envios simultaneos del
    // mismo owner: el segundo espera el commit del primero y lee el turno ya
    // avanzado, en vez de repetir candidato. La fila se siembra por migracion.
    const cursorRows = await input.executor.$queryRaw<
      Array<{ last_assigned_user_id: string | null }>
    >`
      SELECT "last_assigned_user_id"
      FROM "workflow_assignment_cursors"
      WHERE "workflow_owner_id" = ${ownerId}::uuid
      FOR UPDATE
    `;

    if (cursorRows.length === 0) {
      return null;
    }

    const lastAssignedUserId = cursorRows[0]?.last_assigned_user_id ?? null;
    const candidatos = await input.executor.user.findMany({
      where: {
        deletedAt: null,
        recibeAsignacionAutomatica: true,
        state: 1, // USER_STATE.ACTIVE
        workflowOwnerId: ownerId,
      },
      select: {
        firstName: true,
        id: true,
        lastName: true,
        legacyUser: true,
      },
      orderBy: {
        id: "asc",
      },
    });

    if (candidatos.length === 0) {
      return null;
    }

    // El turno se guarda por id, no por posicion: si el ultimo asignado se dio
    // de baja o entro alguien nuevo, la comparacion ">" acomoda el ciclo sola,
    // sin caso especial. Si no hay ninguno mayor, el turno dio la vuelta.
    const siguiente =
      (lastAssignedUserId
        ? candidatos.find((candidato) => candidato.id > lastAssignedUserId)
        : undefined) ?? candidatos[0];

    if (!siguiente) {
      return null;
    }

    const ejecutivoSolicitud = buildExecutiveName(siguiente);
    const updatedSolicitud = await input.executor.solicitud.update({
      where: {
        id: input.solicitudId,
      },
      data: {
        assignedToUserId: siguiente.id,
        ...(ejecutivoSolicitud ? { ejecutivoSolicitud } : {}),
      },
      include: solicitudCoreInclude,
    });

    // Mismo formato que la asignacion manual (ASSIGNMENT_SET), con su propio
    // actionCode para poder distinguir en el historial que fue automatica.
    await input.executor.solicitudEstadoHistorial.create({
      data: {
        actionCode: "ASSIGNMENT_AUTO",
        actionLabel: "Asignación automática",
        changedBy: input.actorUserId,
        comentario: null,
        estadoAnteriorId: solicitud.estadoActualId,
        estadoNuevoId: solicitud.estadoActualId,
        fromOwnerCodeSnapshot: solicitud.estadoActual.owner?.code ?? null,
        fromOwnerIdSnapshot: solicitud.estadoActual.ownerId ?? null,
        fromOwnerNameSnapshot: solicitud.estadoActual.owner?.name ?? null,
        fromStateCodeSnapshot: solicitud.estadoActual.code,
        fromStateNameSnapshot: solicitud.estadoActual.name,
        metadata: {
          assignedToUserId: siguiente.id,
          event: "ASSIGNMENT_AUTO",
          previousAssignedUserId: lastAssignedUserId,
        },
        motivo: "ASSIGNMENT_AUTO",
        requiresComment: false,
        saveAndExit: false,
        solicitudId: solicitud.id,
        toOwnerCodeSnapshot: solicitud.estadoActual.owner?.code ?? null,
        toOwnerIdSnapshot: solicitud.estadoActual.ownerId ?? null,
        toOwnerNameSnapshot: solicitud.estadoActual.owner?.name ?? null,
        toStateCodeSnapshot: solicitud.estadoActual.code,
        toStateNameSnapshot: solicitud.estadoActual.name,
        transitionId: null,
      },
    });

    await input.executor.workflowAssignmentCursor.update({
      where: {
        workflowOwnerId: ownerId,
      },
      data: {
        lastAssignedUserId: siguiente.id,
      },
    });

    return updatedSolicitud;
  }

  private async applyTransition(input: {
    changedBy: string;
    comentario: string | null;
    executor: WorkflowExecutor;
    motivo: string | null;
    now: Date;
    solicitud: SolicitudWithOwner;
    transition: WorkflowTransitionWithToState;
  }) {
    const updateData: Prisma.SolicitudUpdateInput = {
      estadoActual: {
        connect: {
          id: input.transition.toStateId,
        },
      },
    };

    const updatedSolicitud = await input.executor.solicitud.update({
      where: {
        id: input.solicitud.id,
      },
      data: updateData,
      include: solicitudCoreInclude,
    });

    await input.executor.solicitudEstadoHistorial.create({
      data: {
        actionCode: input.transition.actionCode,
        actionLabel: input.transition.actionLabel,
        changedAt: input.now,
        changedBy: input.changedBy,
        comentario: composeWorkflowHistoryComment({
          defaultComment: input.transition.defaultComment,
          manualComment: input.comentario,
        }),
        estadoAnteriorId: input.solicitud.estadoActualId,
        estadoNuevoId: input.transition.toStateId,
        fromOwnerCodeSnapshot: input.solicitud.estadoActual.owner.code,
        fromOwnerIdSnapshot: input.solicitud.estadoActual.owner.id,
        fromOwnerNameSnapshot: input.solicitud.estadoActual.owner.name,
        fromStateCodeSnapshot: input.solicitud.estadoActual.code,
        fromStateNameSnapshot: input.solicitud.estadoActual.name,
        motivo: input.motivo,
        requiresComment: input.transition.requiresComment,
        saveAndExit: input.transition.saveAndExit,
        solicitudId: input.solicitud.id,
        toOwnerCodeSnapshot: input.transition.toState.owner.code,
        toOwnerIdSnapshot: input.transition.toState.owner.id,
        toOwnerNameSnapshot: input.transition.toState.owner.name,
        toStateCodeSnapshot: input.transition.toState.code,
        toStateNameSnapshot: input.transition.toState.name,
        transitionId: input.transition.id,
      },
    });

    return updatedSolicitud;
  }

  async listAvailableTransitions(
    input: Parameters<
      SolicitudWorkflowRepository["listAvailableTransitions"]
    >[0],
  ) {
    const solicitud = await this.loadSolicitudForWorkflow(
      this.prisma,
      input.solicitudId,
    );

    // Excepcion puntual: desde "Transferir", cualquier usuario del owner
    // RIESGO puede ver (y luego ejecutar) la transicion "pagar", ademas del
    // owner actual (TESORERIA). No aplica a ningun otro estado.
    const isRiesgoTransferirException =
      solicitud.estadoActual.code === "Transferir" &&
      input.workflowOwnerCode === "RIESGO";

    if (!input.isSystemAdmin && !isRiesgoTransferirException) {
      this.validateWorkflowOwner(input.workflowOwnerId, solicitud);
    }

    return this.loadActiveTransitions(this.prisma, solicitud.estadoActualId);
  }

  async listHistory(
    input: Parameters<SolicitudWorkflowRepository["listHistory"]>[0],
  ) {
    const solicitud = await this.loadSolicitudForWorkflow(
      this.prisma,
      input.solicitudId,
    );
    if (!canEditSolicitud(input.currentUser, solicitud, "VIEW_HISTORY")) {
      throw new ForbiddenSolicitudAccessError();
    }

    const history = await this.prisma.solicitudEstadoHistorial.findMany({
      where: {
        solicitudId: input.solicitudId,
      },
      include: historyInclude,
      orderBy: {
        changedAt: "desc",
      },
    });

    return history.map(SolicitudWorkflowPrismaDatasource.mapHistory);
  }

  private async loadActiveTransitions(
    executor: WorkflowExecutor,
    fromStateId: string,
  ) {
    const transitions = await executor.workflowTransition.findMany({
      where: {
        fromStateId,
        isActive: true,
      },
      include: transitionInclude,
      orderBy: {
        sortOrder: "asc",
      },
    });

    return transitions.map(SolicitudWorkflowPrismaDatasource.mapTransition);
  }

  private async loadSolicitudForWorkflow(
    executor: WorkflowExecutor,
    solicitudId: string,
  ) {
    const solicitud = await executor.solicitud.findUnique({
      where: {
        id: solicitudId,
      },
      include: solicitudWithOwnerInclude,
    });

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    return solicitud;
  }

  private static mapHistory(record: SolicitudHistoryRecord) {
    return {
      actionCode: record.actionCode,
      actionLabel: record.actionLabel,
      changedAt: record.changedAt,
      changedBy: record.changedBy,
      changedByFullName: SolicitudWorkflowPrismaDatasource.resolveChangedByFullName(record),
      comentario: record.comentario,
      estadoAnterior: {
        code: record.fromStateCodeSnapshot,
        name: record.fromStateNameSnapshot,
        ownerCode: record.fromOwnerCodeSnapshot,
        ownerName: record.fromOwnerNameSnapshot,
      },
      estadoNuevo: {
        code: record.toStateCodeSnapshot,
        name: record.toStateNameSnapshot,
        ownerCode: record.toOwnerCodeSnapshot,
        ownerName: record.toOwnerNameSnapshot,
      },
      id: record.id,
      motivo: record.motivo,
      solicitudId: record.solicitudId,
    };
  }


  private static resolveChangedByFullName(record: SolicitudHistoryRecord) {
    const firstName = record.changedByUser?.firstName?.trim() ?? "";
    const lastName = record.changedByUser?.lastName?.trim() ?? "";
    const fullName = `${firstName} ${lastName}`.trim();

    return fullName || null;
  }
  private static mapTransition(record: WorkflowTransitionWithToState) {
    return {
      actionCode: record.actionCode,
      actionLabel: record.actionLabel,
      blockedReason: null,
      defaultComment: record.defaultComment,
      description: record.description,
      fromStateId: record.fromStateId,
      id: record.id,
      requiresComment: record.requiresComment,
      saveAndExit: record.saveAndExit,
      sortOrder: record.sortOrder,
      toState: {
        code: record.toState.code,
        id: record.toState.id,
        name: record.toState.name,
        owner: {
          code: record.toState.owner.code,
          id: record.toState.owner.id,
          name: record.toState.owner.name,
        },
      },
    };
  }

  private validateWorkflowOwner(
    workflowOwnerId: string | null | undefined,
    solicitud: SolicitudWithOwner,
  ) {
    if (!workflowOwnerId) {
      throw new MissingWorkflowOwnerAssignmentError();
    }

    if (solicitud.estadoActual.ownerId !== workflowOwnerId) {
      throw new ForbiddenSolicitudAccessError();
    }
  }
}

function composeWorkflowHistoryComment(input: {
  defaultComment: string | null | undefined;
  manualComment: string | null | undefined;
}) {
  const defaultComment = input.defaultComment?.trim() || null;
  const manualComment = input.manualComment?.trim() || null;

  if (defaultComment && manualComment) {
    return `${defaultComment}\n\n${manualComment}`;
  }

  return defaultComment ?? manualComment ?? null;
}

// Nombre visible del ejecutivo. Duplica el criterio de
// SolicitudesCorePrismaDatasource.buildExecutiveName para no acoplar los dos
// datasources; si aparece un tercer uso, conviene extraerlo a un modulo comun.
function buildExecutiveName(user: {
  firstName: string | null;
  lastName: string | null;
  legacyUser: string;
}) {
  const fullName = [user.firstName?.trim(), user.lastName?.trim()]
    .filter(Boolean)
    .join(" ")
    .trim();

  return fullName || user.legacyUser.trim() || null;
}
