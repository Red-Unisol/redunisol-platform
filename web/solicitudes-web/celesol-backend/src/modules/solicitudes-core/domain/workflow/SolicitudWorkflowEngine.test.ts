import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SolicitudWorkflowRepository } from "../repositories/SolicitudWorkflowRepository";
import { SolicitudCoreNotFoundError } from "../solicitudes-core-errors";
import { SolicitudTransitionPolicy } from "./SolicitudTransitionPolicy";
import { SolicitudWorkflowEngine } from "./SolicitudWorkflowEngine";
import { SolicitudWorkflowPlanBuilder } from "./SolicitudWorkflowPlanBuilder";
import { SolicitudWorkflowPlanExecutor } from "./SolicitudWorkflowPlanExecutor";
import type {
  WorkflowCommand,
  WorkflowExecutionPlan,
  WorkflowValidationContext,
} from "./types";

describe("SolicitudWorkflowEngine", () => {
  it("orchestrates policy, plan builder, executor and decorator in order", async () => {
    const calls: string[] = [];
    const command = workflowCommand();
    const executionResult = workflowExecutionResult();
    const expectedPlan: WorkflowExecutionPlan = {
      command,
      expectedState: {
        fromStateId: "state-2",
      },
      steps: [
        {
          actionCode: command.actionCode,
          fromStateId: "state-2",
          kind: "domain-transition",
          technical: false,
          toStateId: null,
          transitionId: null,
          transitionInput: command,
        },
      ],
    };

    class PolicySpy extends SolicitudTransitionPolicy {
      override validate(context: WorkflowValidationContext) {
        calls.push("policy");
        assert.equal(context.command, command);
      }
    }

    class BuilderSpy extends SolicitudWorkflowPlanBuilder {
      override build(input: WorkflowCommand, context?: WorkflowValidationContext) {
        calls.push("builder");
        assert.equal(input, command);
        if (context) {
          assert.equal(context.command, command);
        }
        return expectedPlan;
      }
    }

    class ExecutorSpy extends SolicitudWorkflowPlanExecutor {
      constructor() {
        super({ repository: repositoryNoop() });
      }

      override execute(plan: WorkflowExecutionPlan) {
        calls.push("executor");
        assert.equal(plan, expectedPlan);
        return Promise.resolve(executionResult);
      }
    }

    const engine = new SolicitudWorkflowEngine({
      capabilitiesService: {
        decorate: (result) => {
          calls.push("decorator");
          assert.equal(result, executionResult);
          return result;
        },
      },
      planBuilder: new BuilderSpy(),
      planExecutor: new ExecutorSpy(),
      transitionPolicy: new PolicySpy(),
    });

    const result = await engine.execute(command);

    assert.equal(result, executionResult);
    assert.deepEqual(calls, ["policy", "builder", "executor", "decorator"]);
  });

  it("stops execution when policy validation fails", async () => {
    const command = workflowCommand();
    let executorCalled = false;

    class PolicyFail extends SolicitudTransitionPolicy {
      override validate() {
        throw new Error("policy failed");
      }
    }

    class ExecutorSpy extends SolicitudWorkflowPlanExecutor {
      constructor() {
        super({ repository: repositoryNoop() });
      }

      override execute(plan: WorkflowExecutionPlan) {
        executorCalled = true;
        return super.execute(plan);
      }
    }

    const engine = new SolicitudWorkflowEngine({
      planExecutor: new ExecutorSpy(),
      transitionPolicy: new PolicyFail(),
    });

    await assert.rejects(() => engine.execute(command), /policy failed/);
    assert.equal(executorCalled, false);
  });

  it("supports construction with repository-only dependency", async () => {
    let receivedPlan:
      | Parameters<SolicitudWorkflowRepository["executeWorkflowPlan"]>[0]
      | null = null;
    let validationContextCalls = 0;
    const command = workflowCommand();
    const expectedResult = workflowExecutionResult();
    const repository: SolicitudWorkflowRepository = {
      getTransitionValidationContext: async () => {
        validationContextCalls += 1;
        return {
          solicitud: {
            estadoActualId: "state-2",
            ownerId: "owner-1",
          },
          transition: {
            isActive: true,
            requiresComment: false,
            transitionId: "tr-main",
            toStateCode: "RevisionRiesgo",
            toStateId: "state-2",
            toStateIsActive: true,
          },
        };
      },
      executeWorkflowPlan: async (input) => {
        receivedPlan = input;
        return expectedResult;
      },
      listAvailableTransitions: async () => [],
      listHistory: async () => [],
    };
    const engine = new SolicitudWorkflowEngine({ repository });

    const result = await engine.execute(command);

    assert.equal(result, expectedResult);
    assert.deepEqual(receivedPlan, {
      plan: {
        command,
        expectedState: {
          fromStateId: "state-2",
        },
        steps: [
          {
            actionCode: command.actionCode,
            fromStateId: "state-2",
            kind: "domain-transition",
            technical: false,
            toStateId: "state-2",
            transitionId: "tr-main",
            transitionInput: command,
          },
        ],
      },
    });
    assert.equal(validationContextCalls, 1);
  });

  it("builds a plan with technical Motor step when context indicates Motor target", async () => {
    const command = workflowCommand();
    let capturedPlan: WorkflowExecutionPlan | null = null;
    const repository: SolicitudWorkflowRepository = {
      getTransitionValidationContext: async () => ({
        solicitud: {
          estadoActualId: "state-carga",
          ownerId: "owner-1",
        },
        transition: {
          isActive: true,
          requiresComment: false,
          transitionId: "tr-enviar",
          toStateCode: "Motor",
          toStateId: "state-motor",
          toStateIsActive: true,
        },
      }),
      executeWorkflowPlan: async () => workflowExecutionResult(),
      listAvailableTransitions: async () => [],
      listHistory: async () => [],
    };

    class ExecutorPlanSpy extends SolicitudWorkflowPlanExecutor {
      constructor() {
        super({ repository });
      }

      override execute(plan: WorkflowExecutionPlan) {
        capturedPlan = plan;
        return Promise.resolve(workflowExecutionResult());
      }
    }

    const engine = new SolicitudWorkflowEngine({
      planBuilder: new SolicitudWorkflowPlanBuilder(),
      planExecutor: new ExecutorPlanSpy(),
      repository,
      transitionPolicy: new SolicitudTransitionPolicy(),
    });

    const result = await engine.execute(command);

    assert.equal(result.transitions.length, 0);
    assert.ok(capturedPlan);
    const plan = capturedPlan as WorkflowExecutionPlan;
    assert.equal(plan.steps.length, 3);
    assert.equal(plan.steps[0]?.kind, "domain-transition");
    assert.equal(plan.steps[1]?.kind, "technical-transition");
  });

  it("uses repository validation context even when planExecutor is injected", async () => {
    let validationContextCalls = 0;
    const command = workflowCommand();
    const expectedResult = workflowExecutionResult();
    const repository: SolicitudWorkflowRepository = {
      getTransitionValidationContext: async () => {
        validationContextCalls += 1;
        return {
          solicitud: {
            estadoActualId: "state-2",
            ownerId: "owner-1",
          },
          transition: {
            isActive: true,
            requiresComment: false,
            transitionId: "tr-main",
            toStateCode: "RevisionRiesgo",
            toStateId: "state-2",
            toStateIsActive: true,
          },
        };
      },
      executeWorkflowPlan: async () => expectedResult,
      listAvailableTransitions: async () => [],
      listHistory: async () => [],
    };
    const engine = new SolicitudWorkflowEngine({
      planExecutor: new SolicitudWorkflowPlanExecutor({ repository }),
      repository,
    });

    const result = await engine.execute(command);

    assert.equal(result, expectedResult);
    assert.equal(validationContextCalls, 1);
  });

  it("preserves not-found precedence from validation context loader", async () => {
    const command = workflowCommand();
    const repository: SolicitudWorkflowRepository = {
      getTransitionValidationContext: async () => {
        throw new SolicitudCoreNotFoundError();
      },
      executeWorkflowPlan: async () => workflowExecutionResult(),
      listAvailableTransitions: async () => [],
      listHistory: async () => [],
    };
    const engine = new SolicitudWorkflowEngine({
      planExecutor: new SolicitudWorkflowPlanExecutor({ repository }),
      repository,
    });

    await assert.rejects(() => engine.execute(command), SolicitudCoreNotFoundError);
  });
});

function repositoryNoop(): SolicitudWorkflowRepository {
  return {
    executeWorkflowPlan: async () => workflowExecutionResult(),
    listAvailableTransitions: async () => [],
    listHistory: async () => [],
  };
}

function workflowCommand(): WorkflowCommand {
  return {
    actionCode: "revisar",
    changedBy: "user-1",
    comment: "Falta documentacion",
    motivo: "Documentacion incompleta",
    now: new Date("2026-05-18T12:00:00.000Z"),
    solicitudId: "sol-1",
    workflowOwnerId: "owner-1",
  };
}

function workflowExecutionResult() {
  return {
    solicitud: {
      id: "sol-1",
      createdAt: new Date("2026-05-18T10:00:00.000Z"),
      createdBy: "user-1",
      cuotaResultante: null,
      cuotas: null,
      ejecutivoSolicitud: null,
      estadoActual: {
        code: "RevisionRiesgo",
        id: "state-2",
        name: "Revision riesgo",
        ownerId: "owner-2",
      },
      firmaDigitalmente: false,
      legacyOid: null,
      lineaPrestamoDescripcion: "Personal",
      lineaPrestamoLegacyOid: "LP-1",
      montoAFinanciar: null,
      motivo: null,
      nroSolicitud: null,
      observaciones: null,
      garantias: [],
      conyuge: null,
      datosLaborales: {
        actividadLaboral: null,
        antiguedadLaboralMeses: null,
        descuentosSueldo: null,
        domicilioLaboralCalle: null,
        domicilioLaboralLocalidad: null,
        domicilioLaboralNroPuerta: null,
        domicilioLaboralPisoDepto: null,
        empleador: null,
        fechaIngresoLaboral: null,
        montoRecibo: null,
        relacionLaboral: null,
        tarjetas: null,
        vehiculo: null,
        vivienda: null,
      },
      titular: {
        apellidoDenominacion: null,
        cbu: null,
        celular: null,
        cuit: null,
        domicilioCalle: null,
        email: null,
        localidad: null,
        nombre: null,
        nroDocumento: null,
        nroPuerta: null,
        nroSocio: null,
        tipoDocumento: null,
      },
      updatedAt: new Date("2026-05-18T10:00:00.000Z"),
      vendedorSolicitud: null,
    },
    transitions: [],
  };
}
