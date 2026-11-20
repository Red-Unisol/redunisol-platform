import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, it } from "node:test";
import { digest } from "../../../document-review/domain";
import { EXTERNAL_LEGAJO_POLICY_VERSION } from "../../../document-review/external-legajo-policy";
import { eligibleSignatureCandidates, getSignatureApproval, reviewSource, signatureSourceInclude } from "../../../document-review/signature-workflow";
import { candidateFixture } from "../../../document-review/fixtures";
import { assertSignatureLinkFinancialReady } from "./WorkflowFinancialGuard";
import { Prisma, PrismaClient } from "@prisma/client";
import { administrativeSource } from "./AdministrativeCorrectionService";
import { ControlledLoanReplacementService } from "./ControlledLoanReplacementService";
import type { UpdateSolicitudCorePatch } from "../../domain/repositories/SolicitudesCoreRepository";
import { CompleteSellerReview } from "./CompleteSellerReview";
import { SocioRepositoryImpl } from "../../../socios/infrastructure/repositories/SocioRepositoryImpl";
import { SociosPrismaDatasource } from "../../../socios/infrastructure/datasources/SociosPrismaDatasource";
import { GetSolicitudByIdUseCase } from "../../application/use-cases/GetSolicitudById.use-case";
import { UpdateSolicitudUseCase } from "../../application/use-cases/UpdateSolicitud.use-case";
import { SolicitudesCoreRepositoryImpl } from "../repositories/SolicitudesCoreRepositoryImpl";
import { SolicitudFieldAccessRulesPrismaDatasource } from "../datasources/SolicitudFieldAccessRulesPrismaDatasource";
import { SolicitudFieldAccessRulesRepositoryImpl } from "../repositories/SolicitudFieldAccessRulesRepositoryImpl";
import { SolicitudesCorePrismaDatasource } from "../datasources/SolicitudesCorePrismaDatasource";
import { coreConditionsFingerprint, coreReconciliationPending } from "../../domain/workflow/AdministrativeCorrection";
import { SolicitudWorkflowPrismaDatasource } from "../datasources/SolicitudWorkflowPrismaDatasource";
import { SolicitudWorkflowEngine } from "../../domain/workflow/SolicitudWorkflowEngine";
import { actingContext } from "../../../auth/impersonation/context";
import { ForbiddenSolicitudAccessError } from "../../domain/solicitudes-core-errors";
import type { AuthUser } from "../../../auth/domain/entities/User.entity";

const enabled = Boolean(process.env.BEEX_TEST_DATABASE_URL);
const db = new PrismaClient({ datasourceUrl: process.env.BEEX_TEST_DATABASE_URL });
after(() => db.$disconnect());

async function fixture(linked = true) {
  const url = new URL(process.env.BEEX_TEST_DATABASE_URL!);
  assert(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.endsWith("_test"), "Only an explicit local *_test database is allowed");
  const riskOwner = await db.workflowOwner.findUniqueOrThrow({ where: { code: "RIESGO" } });
  const sellerOwner = await db.workflowOwner.findUniqueOrThrow({ where: { code: "VENDEDORES" } });
  const makeUser = (workflowOwnerId: string | null, isSystemAdmin = false) => db.user.create({ data: {
    email: `${randomUUID()}@example.test`, legacyUser: randomUUID(), passwordHash: "test", workflowOwnerId, isSystemAdmin,
  } });
  const [risk, seller, admin] = await Promise.all([makeUser(riskOwner.id), makeUser(sellerOwner.id), makeUser(null, true)]);
  const state = await db.workflowState.findUniqueOrThrow({ where: { code: "Confirmada" } });
  const adjuntoId = randomUUID();
  const s = await db.solicitud.create({ data: {
    createdBy: seller.id, assignedToUserId: risk.id, ejecutivoSolicitud: "Ejecutivo original",
    estadoActualId: state.id, legacyOid: linked ? String(Date.now()) + String(Math.floor(Math.random() * 100000)) : null,
    lineaPrestamoLegacyOid: "55", lineaPrestamoDescripcion: "Línea", montoAFinanciar: 600000,
    montoAprobadoRiesgo: 500000, cuotas: 12, linkFirmaDigital: linked ? "https://example.test/firma-original" : null,
    titular: { create: { nroDocumento: "12345678" } },
    adjuntos: { create: { id: adjuntoId, archivoNombre: "documento-original.pdf", archivoPath: "fixture/original.pdf", uploadedBy: seller.id } },
  } });
  await db.solicitudEstadoHistorial.create({ data: { solicitudId: s.id, estadoNuevoId: state.id, toStateCodeSnapshot: "Confirmada", toStateNameSnapshot: "Confirmada", changedBy: seller.id } });
  const datasource = new SolicitudWorkflowPrismaDatasource(db);
  const engine = new SolicitudWorkflowEngine({ repository: datasource });
  const command = { actionCode: "revisar", changedBy: risk.id, workflowOwnerId: riskOwner.id,
    solicitudId: s.id, now: new Date(), comment: "Corregir condiciones antes de continuar" };
  const clean = async () => {
    await db.solicitudPrestamoReplacement.deleteMany({ where: { solicitudId: s.id } });
    await db.transferenciaDesembolso.deleteMany({ where: { solicitudId: s.id } });
    await db.solicitudEstadoHistorial.deleteMany({ where: { solicitudId: s.id } });
    await db.solicitud.delete({ where: { id: s.id } });
    await db.user.deleteMany({ where: { id: { in: [risk.id, seller.id, admin.id] } } });
  };
  return { s, adjuntoId, risk, seller, admin, riskOwner, sellerOwner, datasource, engine, command, clean };
}

it("the catalog exposes a regular return to Revisar/Vendedores; it preserves links, documents, assignment and complete history", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const previousReplacement = randomUUID();
    await db.solicitud.update({ where: { id: f.s.id }, data: { administrativeCoreControl: {
      correctionId: randomUUID(), loanId: f.s.legacyOid, replacementId: previousReplacement,
      previousLoanId: "443417", reconciledFingerprint: "old-proof",
    } } });
    const available = await f.datasource.listAvailableTransitions({ solicitudId: f.s.id, workflowOwnerId: f.riskOwner.id });
    const transition = available.find(t => t.actionCode === "revisar");
    assert(transition?.requiresComment); assert.equal(transition.toState.code, "Revisar");
    await f.engine.execute(f.command);
    const s = await administrativeSource(db, f.s.id);
    assert.equal(s.estadoActual.code, "Revisar"); assert.equal(s.estadoActual.owner.code, "VENDEDORES");
    assert.equal(s.legacyOid, f.s.legacyOid); assert.equal(s.linkFirmaDigital, f.s.linkFirmaDigital);
    assert.equal(s.assignedToUserId, f.risk.id); assert.equal(s.ejecutivoSolicitud, f.s.ejecutivoSolicitud);
    assert.equal(String(s.montoAFinanciar), "600000"); assert.equal(String(s.montoAprobadoRiesgo), "600000");
    assert.equal((await db.solicitudAdjunto.findUniqueOrThrow({ where: { id: f.adjuntoId } })).archivoPath, "fixture/original.pdf");
    const history = await db.solicitudEstadoHistorial.findMany({ where: { solicitudId: f.s.id }, orderBy: { changedAt: "asc" } });
    assert.equal(history.length, 2);
    const event = history.find(h => h.actionCode === "revisar")!;
    assert.equal(event.transitionId, transition.id); assert.equal(event.realActorUserId, f.risk.id);
    assert.equal(event.changedBy, f.risk.id); assert.match(event.comentario!, /Corregir condiciones/);
    assert.equal(event.fromStateCodeSnapshot, "Confirmada"); assert.equal(event.toStateCodeSnapshot, "Revisar");
    const control = s.administrativeCoreControl as { correctionId: string; replacementId: string; previousLoanId: string; reconciledFingerprint: unknown };
    assert.equal(control.correctionId, event.id); assert.equal(control.replacementId, previousReplacement);
    assert.equal(control.previousLoanId, "443417"); assert.equal(control.reconciledFingerprint, null);
    assert(coreReconciliationPending(s));
    const unavailable = async () => { throw new Error("No external operation is permitted by this test"); };
    const replacement = new ControlledLoanReplacementService({ db, prepare: { prepareReplacement: unavailable }, gateway: { crear: unavailable }, lifecycle: unavailable, loanSnapshot: unavailable, makeSignatureLink: () => "" });
    assert.equal((await replacement.view(s.id, f.admin as unknown as AuthUser)).canReplace, false);
    assert.equal((await replacement.view(s.id, f.risk as unknown as AuthUser)).canReplace, false);
    await db.solicitud.update({ where: { id: s.id }, data: { estadoActualId: f.s.estadoActualId } });
    assert.equal((await replacement.view(s.id, f.admin as unknown as AuthUser)).canReplace, true);
    assert.equal((await replacement.view(s.id, f.risk as unknown as AuthUser)).canReplace, true);
    await assert.rejects(() => f.engine.execute({ ...f.command, actionCode: "liquidar" }), /conciliar/);
  } finally { await f.clean(); }
});

it("an unlinked request returns without a Core reconciliation requirement; admins can use the same regular transition", { skip: !enabled }, async () => {
  const f = await fixture(false);
  try {
    await f.engine.execute({ ...f.command, changedBy: f.admin.id, workflowOwnerId: "", isSystemAdmin: true });
    const s = await administrativeSource(db, f.s.id);
    assert.equal(s.estadoActual.code, "Revisar"); assert.equal(s.legacyOid, null);
    assert.equal(s.administrativeCoreControl, null); assert(!coreReconciliationPending(s));
    const event = await db.solicitudEstadoHistorial.findFirstOrThrow({ where: { solicitudId: s.id, actionCode: "revisar" } });
    assert.equal(event.realActorUserId, f.admin.id); assert(event.transitionId);
  } finally { await f.clean(); }
});

it("regular authorization rejects sellers, inactive actors and a blank reason", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => f.engine.execute({ ...f.command, changedBy: f.seller.id, workflowOwnerId: f.sellerOwner.id }));
    await assert.rejects(() => f.engine.execute({ ...f.command, changedBy: f.seller.id }), ForbiddenSolicitudAccessError);
    await assert.rejects(() => f.engine.execute({ ...f.command, comment: "   " }));
    await db.user.update({ where: { id: f.risk.id }, data: { state: 0 } });
    await assert.rejects(() => f.engine.execute(f.command), ForbiddenSolicitudAccessError);
    assert.equal((await administrativeSource(db, f.s.id)).estadoActual.code, "Confirmada");
    assert.equal(await db.solicitudEstadoHistorial.count({ where: { solicitudId: f.s.id } }), 1);
  } finally { await f.clean(); }
});

it("records the administrator behind an impersonated authorized operator", { skip: !enabled }, async () => {
  const f = await fixture(false);
  try {
    await actingContext.run({ administrator: f.admin as unknown as AuthUser, selectedUser: f.risk as unknown as AuthUser, sessionId: randomUUID(), auditId: randomUUID() }, () => f.engine.execute(f.command));
    const event = await db.solicitudEstadoHistorial.findFirstOrThrow({ where: { solicitudId: f.s.id, actionCode: "revisar" } });
    assert.equal(event.changedBy, f.risk.id); assert.equal(event.realActorUserId, f.admin.id);
    assert(event.impersonationSessionId); assert(event.operationAuditId);
  } finally { await f.clean(); }
});

it("refuses prior financial stages, archived requests, reservations, external payments and uncertain replacements", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    for (const code of ["Liquidada", "VerificarFirmaYDocumentacion", "Transferir", "Pagada"]) {
      const event = await db.solicitudEstadoHistorial.create({ data: { solicitudId: f.s.id, estadoNuevoId: f.s.estadoActualId, toStateCodeSnapshot: code, toStateNameSnapshot: code } });
      await assert.rejects(() => f.engine.execute(f.command), /recorrió etapas/);
      const available = await f.datasource.listAvailableTransitions({ solicitudId: f.s.id, workflowOwnerId: f.riskOwner.id });
      assert.match(available.find(t => t.actionCode === "revisar")!.blockedReason!, /recorrió etapas/);
      await db.solicitudEstadoHistorial.delete({ where: { id: event.id } });
    }
    await db.solicitud.update({ where: { id: f.s.id }, data: { archivedAt: new Date() } });
    await assert.rejects(() => f.engine.execute(f.command), /archivadas/);
    await db.solicitud.update({ where: { id: f.s.id }, data: { archivedAt: null } });
    await db.transferenciaDesembolso.create({ data: { solicitudId: f.s.id, prestamoLegacyId: f.s.legacyOid!, idempotencyKey: randomUUID(), reservationHash: "test", planVersion: "1", plan: {}, clientId: "test", installationId: "test", operator: "test" } });
    await assert.rejects(() => f.engine.execute(f.command), /reserva de desembolso/);
    await db.transferenciaDesembolso.deleteMany({ where: { solicitudId: f.s.id } });
    // Keep the immutable payment guard enabled: roll back the synthetic record
    // instead of trying to delete it during fixture cleanup.
    const rollback = new Error("Rollback synthetic external payment");
    await assert.rejects(() => db.$transaction(async tx => {
      await tx.solicitudPagoExterno.create({ data: { id: randomUUID(), solicitudId: f.s.id, paidOn: new Date(), reference: "test", receiptSha256: "0".repeat(64), adjuntoId: f.adjuntoId, recordedBy: f.admin.id } });
      const engine = new SolicitudWorkflowEngine({ repository: new SolicitudWorkflowPrismaDatasource(db, tx) });
      await assert.rejects(() => engine.execute(f.command), /pago registrado/);
      throw rollback;
    }), error => error === rollback);
    await db.solicitud.update({ where: { id: f.s.id }, data: { administrativeCoreControl: { correctionId: randomUUID(), loanId: f.s.legacyOid, replacementPending: randomUUID() } } });
    await assert.rejects(() => f.engine.execute(f.command), /reemplazo de préstamo/);
    const s = await administrativeSource(db, f.s.id);
    assert.equal(s.estadoActual.code, "Confirmada"); assert.equal(s.legacyOid, f.s.legacyOid);
    assert.equal(await db.solicitudEstadoHistorial.count({ where: { solicitudId: s.id } }), 1);
  } finally { await f.clean(); }
});

it("two concurrent returns create exactly one normal transition event", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled([f.engine.execute(f.command), f.engine.execute(f.command)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(await db.solicitudEstadoHistorial.count({ where: { solicitudId: f.s.id, actionCode: "revisar" } }), 1);
  } finally { await f.clean(); }
});

async function recordCurrentLoanConditions(tx: Prisma.TransactionClient, id: string) {
  const source = await administrativeSource(tx, id);
  assert(source.legacyOid);
  await tx.solicitud.update({ where: { id }, data: {
    administrativeCoreControl: { loanId: source.legacyOid, reconciledFingerprint: coreConditionsFingerprint(source) },
  } });
}

function sellerReviewUseCases() {
  const repository = new SolicitudesCoreRepositoryImpl(new SolicitudesCorePrismaDatasource(db));
  const fieldAccessRulesRepository = new SolicitudFieldAccessRulesRepositoryImpl(new SolicitudFieldAccessRulesPrismaDatasource(db));
  const update = new UpdateSolicitudUseCase({
    repository, fieldAccessRulesRepository,
    lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ legacyOid: "55", descripcion: "Línea", vigente: true, montoMaximo: 1000000, cantidadMaximaCuotas: 48 }) },
    simularCuotaSolicitud: { execute: async () => { throw new Error("Contact changes must not simulate a loan"); } },
  });
  return { update, detail: new GetSolicitudByIdUseCase({ repository, fieldAccessRulesRepository }) };
}

it("records a normal seller save in Revisar and delivers the changes to Análisis", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    await f.engine.execute(f.command);
    const { update, detail } = sellerReviewUseCases();
    await update.execute({
      id: f.s.id, currentUser: { id: f.seller.id, workflowOwnerId: f.sellerOwner.id, workflowOwners: [f.sellerOwner] },
      createdBy: f.seller.id, createdByLegacyUser: f.seller.legacyUser, titular: { celular: "1112345678" },
    });
    await f.engine.execute({
      actionCode: "revisar_reenviar", changedBy: f.seller.id, workflowOwnerId: f.sellerOwner.id, workflowOwners: [f.sellerOwner],
      comment: "Corregí el celular", solicitudId: f.s.id, now: new Date(),
    });
    const riskView = await detail.execute({
      id: f.s.id, currentUser: { id: f.risk.id, workflowOwnerId: f.riskOwner.id, workflowOwners: [f.riskOwner] },
    });
    assert.equal(riskView.estadoActual.code, "RevisionRiesgo");
    assert.deepEqual(riskView.sellerReviewChanges, [{ field: "titular.celular", before: null, after: "1112345678" }]);
  } finally { await f.clean(); }
});

it("lets an analyst with multiple areas request seller review and requires fresh confirmation after corrections", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const treasury = await db.workflowOwner.findUniqueOrThrow({ where: { code: "TESORERIA" } });
    await db.$transaction(async tx => {
      await tx.user.update({ where: { id: f.risk.id }, data: { workflowOwnerId: treasury.id } });
      await tx.userWorkflowOwner.create({ data: { userId: f.risk.id, workflowOwnerId: f.riskOwner.id } });
    });
    const run = (actionCode: string, seller = false) => f.engine.execute({
      actionCode, changedBy: seller ? f.seller.id : f.risk.id,
      workflowOwnerId: seller ? f.sellerOwner.id : treasury.id,
      workflowOwners: seller ? [f.sellerOwner] : [treasury, f.riskOwner],
      solicitudId: f.s.id, now: new Date(),
    });
    await recordCurrentLoanConditions(db, f.s.id);
    const available = async (owner: string) =>
      (await f.datasource.listAvailableTransitions({ solicitudId: f.s.id, workflowOwnerId: owner })).map(t => t.actionCode);
    assert((await available(f.riskOwner.id)).includes("liquidar"));
    await assert.rejects(run("enviar_a_liquidada", true));
    await run("enviar_a_liquidada");
    assert.deepEqual(await available(f.sellerOwner.id), ["desestimar", "finalizar_revision_datos"]);
    assert.equal(String((await administrativeSource(db, f.s.id)).montoAprobadoRiesgo), String(f.s.montoAFinanciar));
    await assert.rejects(run("verificar_firma", true));
    await assert.rejects(run("transferir", true));
    await assert.rejects(run("devolver_revision_datos", true));
    await assert.rejects(run("finalizar_revision_datos"));
    const { update, detail } = sellerReviewUseCases();
    const currentUser = { id: f.seller.id, workflowOwnerId: f.sellerOwner.id, workflowOwners: [f.sellerOwner] };
    const changes = { titular: { celular: "1112345678" } };
    await assert.rejects(update.execute({
      ...changes, id: f.s.id, currentUser, createdBy: f.seller.id, createdByLegacyUser: f.seller.legacyUser,
    }), /Finalizar revisión/);
    const latest = await db.solicitud.findUniqueOrThrow({ where: { id: f.s.id } });
    const review = new CompleteSellerReview(db, update, new SocioRepositoryImpl(new SociosPrismaDatasource(db)));
    const actionCode = "finalizar_revision_datos";
    const corrected = await review.execute({
      actionCode, changes, currentUser, solicitudId: f.s.id, expectedUpdatedAt: latest.updatedAt.toISOString(),
    }, { actionCode, changedBy: f.seller.id, ...currentUser, solicitudId: f.s.id, now: new Date() });
    assert.equal(corrected.solicitud.estadoActual.code, "RevisionRiesgo");
    const riskView = await detail.execute({
      id: f.s.id, currentUser: { id: f.risk.id, workflowOwnerId: treasury.id, workflowOwners: [treasury, f.riskOwner] },
    });
    assert.deepEqual(riskView.sellerReviewChanges, [{ field: "titular.celular", before: null, after: "1112345678" }]);
    assert(corrected.solicitud.sellerReviewStartedAt);
    await run("confirmar");
    assert(!(await available(f.riskOwner.id)).includes("liquidar"));
    await assert.rejects(run("liquidar"));
    await assert.rejects(run("liquidar_con_firma"));
    await run("enviar_a_liquidada");
    const completed = await run("finalizar_revision_datos", true);
    assert.equal(completed.solicitud.estadoActual.code, "VerificarFirmaYDocumentacion");
    assert.equal(completed.solicitud.sellerReviewStartedAt, null);
    const final = await administrativeSource(db, f.s.id);
    assert.equal(final.analisisFinalizadoBy, f.seller.id);
    assert.equal(final.assignedToUserId, f.risk.id);
  } finally { await f.clean(); }
});

const sellerCorrections = [
  { field: "solicitud.fechaPrimerVencimiento", patch: { solicitud: { fechaPrimerVencimiento: "2026-12-02" } } },
  { field: "solicitud.lineaPrestamoLegacyOid", patch: { solicitud: { lineaPrestamoLegacyOid: "56" } } },
  { field: "solicitud.cuotas", patch: { solicitud: { cuotas: 18 } } },
  { field: "titular.nroDocumento", patch: { titular: { nroDocumento: "12345679" } } },
  { field: "titular.cuit", patch: { titular: { cuit: "27123456780" } } },
  { field: "solicitud.observaciones", patch: { solicitud: { observaciones: "Nota" } } },
] satisfies Array<{ field: string; patch: UpdateSolicitudCorePatch }>;

for (const { field, patch } of sellerCorrections) {
  it(`seller correction of ${field} handles earlier signature evidence and the current loan terms`, { skip: !enabled }, async () => {
    const f = await fixture();
    const id = f.s.id;
    const loanId = f.s.legacyOid!;
    let dueInCore = "2026-12-02";
    const verifyLoan: typeof assertSignatureLinkFinancialReady = (tx, sourceId) => assertSignatureLinkFinancialReady(tx, sourceId, {
      lifecycle: async () => ({ id: loanId, account: "100", estado: 0, estadoLabel: "Activa", estadoPrestamo: 0,
        estadoPrestamoLabel: "Pendiente", vigente: true, saldo: 100 }),
      loanSnapshot: async () => ({ id: loanId, estado: 0, amount: 600000, cuotas: 12, lineaId: "55",
        primerVencimiento: dueInCore, cancelacionesCentavos: 0 }),
      lineResolver: { resolveByPresolicitudOid: async oid => ({ id: oid, codigoMutual: null }) },
    });
    const rollback = new Error("Rollback de las evidencias inmutables de prueba");
    try {
      await assert.rejects(db.$transaction(async tx => {
        const engine = new SolicitudWorkflowEngine({
          repository: new SolicitudWorkflowPrismaDatasource(db, tx, undefined, verifyLoan),
        });
        const run = (actionCode: string, seller = false) => engine.execute({
          actionCode, changedBy: seller ? f.seller.id : f.risk.id, workflowOwnerId: seller ? f.sellerOwner.id : f.riskOwner.id,
          solicitudId: id, now: new Date(),
        });
        const source = () => tx.solicitud.findUniqueOrThrow({ where: { id }, include: signatureSourceInclude });
        const priorCycleId = randomUUID();
        await tx.solicitud.update({ where: { id }, data: {
          fechaPrimerVencimiento: new Date("2026-12-01"), titular: { update: { cuit: "20123456786" } },
          signatureCycleId: priorCycleId, signatureExcludedVerificationIds: ["previously-excluded"],
        } });
        await recordCurrentLoanConditions(tx, id);
        await run("enviar_a_liquidada");
        // A legacy review can return corrections to Riesgo even without a saved financial control.
        if (field === "titular.cuit") await tx.solicitud.update({ where: { id }, data: { administrativeCoreControl: Prisma.DbNull } });
        const beforeEdit = await source();
        const previous = reviewSource(beforeEdit);
        const review = await tx.solicitudDocumentReview.create({ data: {
          solicitudId: id, evaluationKey: randomUUID(), policyVersion: EXTERNAL_LEGAJO_POLICY_VERSION,
          sourceFingerprint: digest(previous), sourceSnapshot: JSON.parse(JSON.stringify(previous)), providerFingerprint: "external",
          assessment: { attempts: [{ verificationId: "earlier-attempt" }, { verificationId: "open-attempt" }] }, systemDecision: "not_approve",
          legajoAdjuntoId: f.adjuntoId, evidencePath: "test/legajo.json",
        } });
        const decision = await tx.solicitudDocumentDecision.create({ data: {
          reviewId: review.id, requestId: randomUUID(), humanDecision: "approve", systemDecision: "not_approve",
          disagreesWithSystem: true, overridesAttempt: false, reason: "Legajo externo aprobado", decidedBy: f.admin.id,
          actorName: "Revisor", actingAudit: { evidenceType: "external", confirmed: true, externalDocuments: [{name: "legajo.pdf"}] },
          legajoAdjuntoId: f.adjuntoId,
        } });
        assert((await getSignatureApproval(tx, id)).approved);
        const updated = await new SolicitudesCorePrismaDatasource(db).update(id, patch, {
          expectedEstadoActualId: beforeEdit.estadoActualId, enforceMontoAprobadoRiesgo: true, sellerReviewActor: "seller",
        }, tx);
        if (field === "titular.cuit") {
          assert.equal(updated.titular.nroDocumento, beforeEdit.titular?.nroDocumento);
          assert.equal(updated.titular.cuit, "27123456780");
          // CUIT alone leaves the signed-source digest unchanged until the new cycle starts.
          assert.equal(digest(reviewSource(await source())), digest(previous));
        }
        await run("finalizar_revision_datos", true);
        const corrected = await source();
        assert.equal(corrected.estadoActual.code, "RevisionRiesgo");
        assert(await tx.solicitudDocumentDecision.findUnique({ where: { id: decision.id } }));
        const contractual = field !== "solicitud.observaciones";
        assert.equal((await getSignatureApproval(tx, id)).approved, !contractual);
        assert.equal(await tx.beexNotification.count({ where: { solicitudId: id, kind: "signature_requested" } }), contractual ? 1 : 0);
        if (contractual) {
          assert(corrected.signatureRequestedAt && corrected.signatureCycleId);
          assert.notEqual(corrected.signatureCycleId, priorCycleId);
          const excluded = ["previously-excluded", "earlier-attempt", "open-attempt"];
          assert.deepEqual(corrected.signatureExcludedVerificationIds, excluded);
          const completeAfterCorrection = (verificationId: string) => ({
            ...candidateFixture(verificationId), completedAt: new Date(corrected.signatureRequestedAt!.getTime() + 1000).toISOString(),
          });
          const fresh = completeAfterCorrection("new-attempt");
          assert.deepEqual(eligibleSignatureCandidates(corrected, [...excluded.map(completeAfterCorrection), fresh]), [fresh]);
          const event = await tx.solicitudEstadoHistorial.findFirstOrThrow({ where: { solicitudId: id, actionCode: "devolver_revision_datos" } });
          assert.equal((event.metadata as Record<string, unknown>).signatureCycleId, corrected.signatureCycleId);
        } else {
          assert.equal(corrected.signatureCycleId, priorCycleId);
          assert.deepEqual(corrected.signatureExcludedVerificationIds, ["previously-excluded"]);
          await run("confirmar");
          await run("enviar_a_liquidada");
          // Even a reconciled request must pass the strict check against current Vimarx terms.
          assert.equal(coreReconciliationPending(await administrativeSource(tx, id)), false);
          await assert.rejects(run("finalizar_revision_datos", true), /no coincide/);
          assert.equal((await source()).estadoActual.code, "Liquidada");
          assert.equal(await tx.solicitudEstadoHistorial.count({ where: { solicitudId: id, actionCode: "transferir" } }), 0);
          dueInCore = "2026-12-01";
          assert.equal((await run("finalizar_revision_datos", true)).solicitud.estadoActual.code, "Transferir");
        }
        throw rollback;
      }), error => error === rollback);
    } finally {
      await f.clean();
    }
  });
}
