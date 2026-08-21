import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SolicitudWorkflowRepository } from "../repositories/SolicitudWorkflowRepository";
import { WorkflowExecutionPlanNotExecutableError } from "../solicitudes-core-errors";
import { SolicitudWorkflowPlanExecutor } from "./SolicitudWorkflowPlanExecutor";
import type { WorkflowCommand, WorkflowExecutionPlan } from "./types";

describe("SolicitudWorkflowPlanExecutor", () => {
  it("delegates executable plan to repository.executeWorkflowPlan", async () => {
    let received: Parameters<SolicitudWorkflowRepository["executeWorkflowPlan"]>[0] | null =
      null;
    const repository = repositoryMock({
      onExecuteWorkflowPlan: (input) => {
        received = input;
      },
    });
    const executor = new SolicitudWorkflowPlanExecutor({ repository });
    const command = workflowCommand();
    const fromStepInput = {
      ...command,
      actionCode: "preaprobar",
    };
    const plan: WorkflowExecutionPlan = {
      command,
      expectedState: {
        fromStateId: "state-1",
      },
      steps: [
        {
          actionCode: fromStepInput.actionCode,
          fromStateId: "state-1",
          kind: "domain-transition",
          technical: false,
          toStateId: "state-2",
          transitionId: "tr-main",
          transitionInput: fromStepInput,
        },
      ],
    };

    await executor.execute(plan);

    assert.deepEqual(received, { plan });
  });

  it("rejects non-executable plan when no domain step is present", async () => {
    let executeWorkflowPlanCalls = 0;
    const repository = repositoryMock({
      onExecuteWorkflowPlan: () => {
        executeWorkflowPlanCalls += 1;
      },
    });
    const executor = new SolicitudWorkflowPlanExecutor({ repository });
    const command = workflowCommand();
    const plan: WorkflowExecutionPlan = {
      command,
      expectedState: {
        fromStateId: null,
      },
      steps: [],
    };

    assert.throws(
      () => executor.execute(plan),
      (error: unknown) => error instanceof WorkflowExecutionPlanNotExecutableError,
    );

    assert.equal(executeWorkflowPlanCalls, 0);
  });

  it("rejects non-executable plan when expected state is missing", async () => {
    let executeWorkflowPlanCalls = 0;
    const repository = repositoryMock({
      onExecuteWorkflowPlan: () => {
        executeWorkflowPlanCalls += 1;
      },
    });
    const executor = new SolicitudWorkflowPlanExecutor({ repository });
    const command = workflowCommand();
    const plan: WorkflowExecutionPlan = {
      command,
      expectedState: {
        fromStateId: null,
      },
      steps: [
        {
          actionCode: command.actionCode,
          fromStateId: "state-carga",
          kind: "domain-transition",
          technical: false,
          toStateId: "state-motor",
          transitionId: "tr-main",
          transitionInput: command,
        },
      ],
    };

    assert.throws(
      () => executor.execute(plan),
      (error: unknown) => error instanceof WorkflowExecutionPlanNotExecutableError,
    );

    assert.equal(executeWorkflowPlanCalls, 0);
  });

  it("delegates mixed domain+technical plan without executing technical step in executor", async () => {
    let received: Parameters<SolicitudWorkflowRepository["executeWorkflowPlan"]>[0] | null =
      null;
    const repository = repositoryMock({
      onExecuteWorkflowPlan: (input) => {
        received = input;
      },
    });
    const executor = new SolicitudWorkflowPlanExecutor({ repository });
    const command = workflowCommand();
    const fromStepInput = {
      ...command,
      actionCode: "enviar",
    };
    const plan: WorkflowExecutionPlan = {
      command,
      expectedState: {
        fromStateId: "state-carga",
      },
      steps: [
        {
          actionCode: fromStepInput.actionCode,
          fromStateId: "state-carga",
          kind: "domain-transition",
          technical: false,
          toStateId: "state-motor",
          transitionId: "tr-enviar",
          transitionInput: fromStepInput,
        },
        {
          actionCode: "motor",
          fromStateId: "state-motor",
          kind: "technical-transition",
          technical: true,
          toStateId: "state-riesgo",
          transitionId: "tr-motor",
        },
      ],
    };

    await executor.execute(plan);

    assert.deepEqual(received, { plan });
  });
});

function repositoryMock(hooks: {
  onExecuteWorkflowPlan?: (
    input: Parameters<SolicitudWorkflowRepository["executeWorkflowPlan"]>[0],
  ) => void;
}): SolicitudWorkflowRepository {
  return {
    executeWorkflowPlan: async (input) => {
      hooks.onExecuteWorkflowPlan?.(input);
      return {
        solicitud: solicitud(),
        transitions: [],
      };
    },
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

function solicitud() {
  return {
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
  };
}
