import type {
  WorkflowCommand,
  WorkflowExecutionPlan,
  WorkflowValidationContext,
} from "./types";

// Owner cuyo ingreso dispara el reparto por turno. Si manana otra area
// (por ejemplo TESORERIA) tuviera que repartir igual, se suma aca.
const AUTO_ASSIGNMENT_OWNER_CODE = "RIESGO";

export class SolicitudWorkflowPlanBuilder {
  build(
    command: WorkflowCommand,
    context?: WorkflowValidationContext,
  ): WorkflowExecutionPlan {
    const fromStateId = context?.transitionValidation.solicitud?.estadoActualId ?? null;
    const transition = context?.transitionValidation.transition;
    const plan: WorkflowExecutionPlan = {
      command,
      expectedState: {
        fromStateId,
      },
      steps: [
        {
          actionCode: command.actionCode,
          fromStateId,
          kind: "domain-transition",
          technical: false,
          toStateId: transition?.toStateId ?? null,
          transitionId: transition?.transitionId ?? null,
          transitionInput: command,
        },
      ],
    };

    if (transition?.toStateCode === "Motor" && transition.toStateId) {
      plan.steps.push({
        actionCode: "motor",
        fromStateId: transition.toStateId,
        kind: "technical-transition",
        technical: true,
        toStateId: null,
        transitionId: null,
      });
    }

    // Reparto por turno. Se intenta cuando la solicitud entra al owner que
    // asigna: de forma directa (revisar_reenviar, revisar_monto_cuota) o
    // encadenada por el paso tecnico "motor", que termina en RevisionRiesgo.
    // Aca solo se declara la intencion: el datasource lee el owner real del
    // estado final y decide si corresponde asignar y a quien.
    const entraAlOwnerQueReparte =
      transition?.toStateOwnerCode === AUTO_ASSIGNMENT_OWNER_CODE ||
      transition?.toStateCode === "Motor";

    if (entraAlOwnerQueReparte) {
      plan.steps.push({
        actionCode: "auto_assign",
        kind: "auto-assignment",
        technical: true,
      });
    }

    return plan;
  }
}
