import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  CONYUGE_EDITABLE_FIELDS,
  DATOS_LABORALES_EDITABLE_FIELDS,
  EDITABLE_FIELDS,
  READONLY_REASON,
  SOLICITUD_EDITABLE_FIELDS,
  TITULAR_EDITABLE_FIELDS,
} from "../../application/services/SolicitudFieldAccess";
import {
  EXPECTED_ACTIVE_WORKFLOW_STATES,
  EXPECTED_ACTIVE_WORKFLOW_TRANSITIONS,
  EXPECTED_WORKFLOW_BOOTSTRAP_METADATA,
} from "./SolicitudWorkflowCatalog.test-constants";
import {
  createBootstrapTestPrismaClient,
  getBootstrapTestDatabaseUrl,
  resetBootstrapTestDatabase,
} from "./solicitudes-core-bootstrap-test-db";
import { WorkflowTransitionAdminPrismaDatasource } from "./WorkflowTransitionAdminPrismaDatasource";

const SHOULD_RUN_BOOTSTRAP_TESTS = getBootstrapTestDatabaseUrl() !== null;

const REVISAR_BOOTSTRAP_FIELDS = [
  ...SOLICITUD_EDITABLE_FIELDS.filter(
    (field) =>
      field !== "solicitud.firmaDigitalmente" &&
      field !== "solicitud.linkFirmaDigital",
  ),
  ...TITULAR_EDITABLE_FIELDS,
  ...CONYUGE_EDITABLE_FIELDS,
  ...DATOS_LABORALES_EDITABLE_FIELDS,
];

describe("Solicitud workflow metadata bootstrap", () => {
  if (!SHOULD_RUN_BOOTSTRAP_TESTS) {
    it.skip("requires TEST_DATABASE_URL");
    return;
  }

  const prisma = createBootstrapTestPrismaClient();
  const datasource = new WorkflowTransitionAdminPrismaDatasource(prisma);

  before(() => {
    resetBootstrapTestDatabase();
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("applies the versioned workflow metadata bootstrap on a clean test database", async () => {
    const states = await prisma.workflowState.findMany({
      where: { isActive: true },
      include: { owner: { select: { code: true } } },
      orderBy: { code: "asc" },
    });
    const transitions = await prisma.workflowTransition.findMany({
      where: { isActive: true },
      select: {
        actionCode: true,
        actionLabel: true,
        defaultComment: true,
        description: true,
        fromState: { select: { code: true } },
        requiresComment: true,
        sortOrder: true,
        toState: { select: { code: true } },
      },
      orderBy: [
        { fromState: { code: "asc" } },
        { actionCode: "asc" },
      ],
    });
    const rules = await prisma.solicitudFieldAccessRule.findMany({
      include: {
        workflowState: {
          select: { code: true },
        },
      },
      orderBy: {
        workflowState: { code: "asc" },
      },
    });

    assert.deepEqual(
      states.map((state) => `${state.code}|${state.owner.code}`),
      EXPECTED_ACTIVE_WORKFLOW_STATES,
    );
    assert.deepEqual(
      transitions.map(
        (transition) =>
          `${transition.fromState.code}|${transition.actionCode}|${transition.toState.code}`,
      ),
      EXPECTED_ACTIVE_WORKFLOW_TRANSITIONS,
    );

    const metadataByKey = new Map(
      transitions.map((transition) => [
        `${transition.fromState.code}|${transition.actionCode}|${transition.toState.code}`,
        {
          actionLabel: transition.actionLabel,
          defaultComment: transition.defaultComment,
          description: transition.description,
          requiresComment: transition.requiresComment,
          sortOrder: transition.sortOrder,
        },
      ]),
    );

    assert.deepEqual(
      Object.fromEntries(metadataByKey.entries()),
      EXPECTED_WORKFLOW_BOOTSTRAP_METADATA,
    );

    const rulesByState = new Map(
      rules.map((rule) => [
        rule.workflowState.code,
        {
          active: rule.active,
          backgroundColor: rule.backgroundColor,
          defaultMode: rule.defaultMode,
          editableFields: rule.editableFields,
          editableGroups: rule.editableGroups,
          readonlyReason: rule.readonlyReason,
          textColor: rule.textColor,
          version: rule.version,
        },
      ]),
    );

    assert.deepEqual(rulesByState.get("CargaVendedor"), {
      active: true,
      backgroundColor: null,
      defaultMode: "readonly",
      editableFields: [...EDITABLE_FIELDS],
      editableGroups: [],
      readonlyReason: null,
      textColor: null,
      version: 5,
    });
    assert.deepEqual(rulesByState.get("Revisar"), {
      active: true,
      backgroundColor: null,
      defaultMode: "readonly",
      editableFields: REVISAR_BOOTSTRAP_FIELDS,
      editableGroups: ["garantias"],
      readonlyReason: null,
      textColor: null,
      version: 1,
    });
    assert.deepEqual(rulesByState.get("RevisionRiesgo"), {
      active: true,
      backgroundColor: null,
      defaultMode: "readonly",
      editableFields: [
        "solicitud.cupoTitular",
        "solicitud.cuotaResultante",
        "solicitud.cuotas",
        "solicitud.fechaPrimerVencimiento",
        "solicitud.montoAFinanciar",
        "solicitud.observaciones",
        "solicitud.vendedorSolicitud",
      ],
      editableGroups: [],
      readonlyReason: READONLY_REASON,
      textColor: null,
      version: 2,
    });
    assert.deepEqual(rulesByState.get("PreAprobada"), {
      active: true,
      backgroundColor: "#C0FFFF",
      defaultMode: "readonly",
      editableFields: ["solicitud.observaciones"],
      editableGroups: [],
      readonlyReason: READONLY_REASON,
      textColor: "#000000",
      version: 3,
    });
    assert.deepEqual(rulesByState.get("VerificarFirmaYDocumentacion"), {
      active: true,
      backgroundColor: "#FFC0FF",
      defaultMode: "readonly",
      editableFields: ["solicitud.observaciones"],
      editableGroups: [],
      readonlyReason: READONLY_REASON,
      textColor: "#000000",
      version: 2,
    });
    assert.deepEqual(rulesByState.get("VerificacionDocumentacion"), {
      active: false,
      backgroundColor: "#FFC0FF",
      defaultMode: "readonly",
      editableFields: ["solicitud.observaciones"],
      editableGroups: [],
      readonlyReason: READONLY_REASON,
      textColor: "#000000",
      version: 2,
    });
    assert.deepEqual(rulesByState.get("Desestimada"), {
      active: true,
      backgroundColor: "#FF7F7F",
      defaultMode: "readonly",
      editableFields: ["solicitud.observaciones"],
      editableGroups: [],
      readonlyReason: READONLY_REASON,
      textColor: "#000000",
      version: 2,
    });
    assert.deepEqual(rulesByState.get("Rechazada"), {
      active: true,
      backgroundColor: "#FF7F7F",
      defaultMode: "readonly",
      editableFields: [],
      editableGroups: [],
      readonlyReason: READONLY_REASON,
      textColor: "#000000",
      version: 1,
    });
    assert.deepEqual(rulesByState.get("Vencida"), {
      active: true,
      backgroundColor: "#FF7F7F",
      defaultMode: "readonly",
      editableFields: [],
      editableGroups: [],
      readonlyReason: READONLY_REASON,
      textColor: "#000000",
      version: 1,
    });
    assert.deepEqual(rulesByState.get("Pagada"), {
      active: true,
      backgroundColor: "#C0FFC0",
      defaultMode: "readonly",
      editableFields: [],
      editableGroups: [],
      readonlyReason: READONLY_REASON,
      textColor: "#000000",
      version: 1,
    });
  });

  it("persists requiresComment changes without changing the workflow topology", async () => {
    const transition = await prisma.workflowTransition.findFirstOrThrow({
      where: {
        actionCode: "preaprobar",
        fromState: { code: "RevisionRiesgo" },
      },
      select: {
        actionCode: true,
        actionLabel: true,
        defaultComment: true,
        description: true,
        fromState: { select: { code: true } },
        id: true,
        requiresComment: true,
        sortOrder: true,
        toState: { select: { code: true } },
        updatedAt: true,
      },
    });

    assert.equal(transition.requiresComment, false);

    const updatedToTrue = await datasource.updateTransitionMetadata({
      actionLabel: transition.actionLabel,
      defaultComment: transition.defaultComment,
      description: transition.description,
      requiresComment: true,
      sortOrder: transition.sortOrder,
      transitionId: transition.id,
      updatedAt: transition.updatedAt.toISOString(),
    });

    assert.equal(updatedToTrue.requiresComment, true);
    assert.equal(updatedToTrue.actionCode, "preaprobar");
    assert.equal(updatedToTrue.toState.code, "PreAprobada");

    const reloadedTrue = await prisma.workflowTransition.findUniqueOrThrow({
      where: { id: transition.id },
      select: {
        actionCode: true,
        fromState: { select: { code: true } },
        requiresComment: true,
        toState: { select: { code: true } },
        updatedAt: true,
      },
    });

    assert.equal(reloadedTrue.requiresComment, true);
    assert.equal(reloadedTrue.actionCode, "preaprobar");
    assert.equal(reloadedTrue.fromState.code, "RevisionRiesgo");
    assert.equal(reloadedTrue.toState.code, "PreAprobada");

    const updatedToFalse = await datasource.updateTransitionMetadata({
      actionLabel: transition.actionLabel,
      defaultComment: transition.defaultComment,
      description: transition.description,
      requiresComment: false,
      sortOrder: transition.sortOrder,
      transitionId: transition.id,
      updatedAt: reloadedTrue.updatedAt.toISOString(),
    });

    assert.equal(updatedToFalse.requiresComment, false);

    const reloadedFalse = await prisma.workflowTransition.findUniqueOrThrow({
      where: { id: transition.id },
      select: {
        actionCode: true,
        fromState: { select: { code: true } },
        requiresComment: true,
        toState: { select: { code: true } },
      },
    });

    assert.equal(reloadedFalse.requiresComment, false);
    assert.equal(reloadedFalse.actionCode, "preaprobar");
    assert.equal(reloadedFalse.fromState.code, "RevisionRiesgo");
    assert.equal(reloadedFalse.toState.code, "PreAprobada");
  });
});
