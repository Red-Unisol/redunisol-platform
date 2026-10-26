import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { administrativeSource } from "./AdministrativeCorrectionService";
import { ControlledLoanReplacementService } from "./ControlledLoanReplacementService";
import { coreReconciliationPending } from "../../domain/workflow/AdministrativeCorrection";
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
    assert.equal((await replacement.view(s.id, f.admin as unknown as AuthUser)).canReplace, true);
    assert.equal((await replacement.view(s.id, f.risk as unknown as AuthUser)).canReplace, false);
    await db.solicitud.update({ where: { id: s.id }, data: { estadoActualId: f.s.estadoActualId } });
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
