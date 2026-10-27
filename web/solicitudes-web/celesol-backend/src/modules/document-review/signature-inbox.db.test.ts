import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import type { AuthUser } from "../auth/domain/entities/User.entity";
import type { CoreLoanLifecycle } from "../solicitudes-core/infrastructure/services/ControlledLoanReplacementService";
import type { SignatureInboxLoanState } from "../solicitudes/infrastructure/services/EvaluateListSolicitudesGateway";
import { DocumentReviewService } from "./DocumentReviewService";
import { assess, digest, DocumentReviewError, providerFingerprint, REVIEW_POLICY_VERSION } from "./domain";
import { candidateFixture } from "./fixtures";
import { reviewSource, signatureSourceInclude, type SignatureSourceRow, type SignatureStatus } from "./signature-workflow";

const url = process.env.BEEX_TEST_DATABASE_URL;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
type Dependencies = ConstructorParameters<typeof DocumentReviewService>[0];

test("PostgreSQL signature inbox filters paid loans and preserves linked applications and evidence", { skip: !url }, async t => {
  const parsed = new URL(url!);
  assert(
    ["127.0.0.1", "localhost"].includes(parsed.hostname) && parsed.pathname.endsWith("_test"),
    "BEEX_TEST_DATABASE_URL must point to an explicit local *_test database",
  );
  const db = new PrismaClient({ datasourceUrl: url, log: [{ emit: "event", level: "query" }] });
  t.after(() => db.$disconnect());
  const queries: string[] = [];
  db.$on("query", event => queries.push(event.query));
  const [owner, confirmed, initial, paid] = await Promise.all([
    db.workflowOwner.findUniqueOrThrow({ where: { code: "LEGAJOS_DIGITALES" } }),
    db.workflowState.findUniqueOrThrow({ where: { code: "Confirmada" } }),
    db.workflowState.findUniqueOrThrow({ where: { code: "CargaVendedor" } }),
    db.workflowState.findUniqueOrThrow({ where: { code: "Pagada" } }),
  ]);
  const ids: string[] = [];
  let actorId = "";
  const rollback = new Error("Rollback isolated signature inbox fixtures");
  await assert.rejects(db.$transaction(async tx => {
    const actor = await tx.user.create({ data: {
      email: `${randomUUID()}@example.invalid`, legacyUser: randomUUID(),
      passwordHash: "no-login", workflowOwnerId: owner.id,
      firstName: "Legajos", lastName: "de Prueba",
    } });
    actorId = actor.id;
    const user: AuthUser = { ...actor, workflowOwner: { id: owner.id, code: owner.code, name: owner.name } };
    let sequence = 0;
    const loanPrefix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
    async function source(patch: Partial<Prisma.SolicitudUncheckedCreateInput> = {}) {
      const number = ++sequence;
      const loanId = `${loanPrefix}${number}`;
      const row = await tx.solicitud.create({ data: {
        createdBy: actor.id, estadoActualId: confirmed.id, legacyOid: loanId,
        nroSolicitud: `INBOX-TEST-${randomUUID()}`, lineaPrestamoLegacyOid: "1",
        lineaPrestamoDescripcion: "Línea de prueba", lineaPrestamoCodigoMutual: "CELESOL",
        montoAFinanciar: 1000, cuotas: 6, cuotaResultante: "200,00",
        linkFirmaDigital: `https://example.invalid/sign/${loanId}`,
        updatedAt: new Date(Date.UTC(2026, 9, 1, 12, 0, number)),
        administrativeCoreControl: { loanId, correctionId: randomUUID(), reconciledFingerprint: "preserved-control" },
        titular: { create: { nombre: "Persona", apellidoDenominacion: "de Prueba", nroDocumento: "30123456" } },
        ...patch,
      }, include: signatureSourceInclude });
      ids.push(row.id);
      return row;
    }
    const cancelled = await source({ estadoActualId: initial.id, nroSolicitud: null });
    const first = await source({ estadoActualId: initial.id, nroSolicitud: null });
    const corePaid = await source();
    const sent = await source();
    const second = await source();
    const reserved = await source();
    const external = await source();
    const terminal = await source({ estadoActualId: paid.id });
    const archived = await source({ archivedAt: new Date("2026-10-20T12:00:00Z") });
    const unlinked = await source({ legacyOid: null, linkFirmaDigital: null });

    await tx.transferenciaDesembolso.create({ data: {
      solicitudId: reserved.id, prestamoLegacyId: reserved.legacyOid!, idempotencyKey: randomUUID(),
      reservationHash: randomUUID(), planVersion: "test", plan: {}, clientId: "test-client",
      installationId: "test-installation", operator: "test-operator",
    } });
    const receipt = await tx.solicitudAdjunto.create({ data: {
      solicitudId: external.id, archivoNombre: "external-test.pdf", archivoPath: `test/${randomUUID()}.pdf`,
      archivoMimeType: "application/pdf", archivoSizeBytes: 100n, storageBucket: "test-only",
      tipoAdjunto: "Comprobante de transferencia", estadoAdjunto: "Cargado", uploadedBy: actor.id,
    } });
    await tx.solicitudPagoExterno.create({ data: {
      id: randomUUID(), solicitudId: external.id, paidOn: new Date("2026-10-20"), reference: "test-reference",
      receiptSha256: "0".repeat(64), adjuntoId: receipt.id, recordedBy: actor.id,
    } });
    await tx.solicitudEstadoHistorial.create({ data: {
      solicitudId: cancelled.id, estadoNuevoId: initial.id,
      toStateCodeSnapshot: initial.code, toStateNameSnapshot: initial.name,
      actionCode: "TEST_HISTORICAL_LINK", comentario: "Historical trace must remain intact", changedBy: actor.id,
      metadata: { previousLoanId: "previous-loan", currentLoanId: cancelled.legacyOid },
    } });
    async function observation(row: SignatureSourceRow, completed: boolean) {
      const source = reviewSource(row);
      const candidates = completed ? [candidateFixture()] : [];
      const assessment = assess(source, candidates);
      return tx.solicitudDocumentReview.create({ data: {
        solicitudId: row.id, evaluationKey: randomUUID(), policyVersion: REVIEW_POLICY_VERSION,
        sourceFingerprint: digest(source), providerFingerprint: providerFingerprint(candidates),
        sourceSnapshot: json(source), assessment: json(assessment), systemDecision: assessment.decision,
        selectedVerificationId: assessment.selectedVerificationId,
        evidencePath: `test/${row.id}/${randomUUID()}.json`,
      } });
    }
    await observation(sent, true);
    const historicalReview = await observation(cancelled, false);
    await tx.solicitudDocumentDecision.create({ data: {
      reviewId: historicalReview.id, requestId: randomUUID(), humanDecision: "not_approve",
      systemDecision: "not_approve", disagreesWithSystem: false, overridesAttempt: false,
      reason: "Historical decision must remain intact", decidedBy: actor.id, actorName: "Legajos de Prueba", actingAudit: {},
    } });

    const lifecycle = (row: SignatureSourceRow): CoreLoanLifecycle => ({
      id: row.legacyOid, account: "test-account", estado: 0, estadoLabel: "Normal",
      estadoPrestamo: 1, estadoPrestamoLabel: "Nuevo", vigente: true, saldo: 1000,
    });
    const ownStates = new Map<string, SignatureInboxLoanState>([
      [cancelled.id, { lifecycle: { ...lifecycle(cancelled), estado: 3, estadoLabel: "Anulada", estadoPrestamoLabel: "Anulado", vigente: false, saldo: 0 }, transferred: false }],
      [first.id, { lifecycle: lifecycle(first), transferred: false }],
      [corePaid.id, { lifecycle: null, transferred: true }],
      [sent.id, { lifecycle: lifecycle(sent), transferred: false }],
      [second.id, { lifecycle: lifecycle(second), transferred: false }],
    ]);
    const readerCalls: string[][] = [];
    let upstreamUnavailable = false;
    const service = new DocumentReviewService({
      db: tx as unknown as PrismaClient,
      inboxLoanStates: async rows => {
        readerCalls.push(rows.filter(row => ids.includes(row.id)).map(row => row.id));
        if (upstreamUnavailable) throw new Error("Vimarx unavailable");
        // Other suites may have independent rows in this database. Return a
        // closed external state for those rows, without changing their data.
        return new Map(rows.map(row => [row.id, ownStates.get(row.id) ?? { lifecycle: null, transferred: true }]));
      },
      bucket: "test-only", maxPdfBytes: 1000,
      gateway: {
        candidates: async () => assert.fail("Inbox must not fetch evidence"),
        download: async () => assert.fail("Inbox must not download evidence"),
      },
      storage: {} as Dependencies["storage"],
      buildLegajo: async () => assert.fail("Inbox must not build a legajo"),
      transition: async () => assert.fail("Inbox must not change workflow"),
    });
    const snapshot = () => tx.solicitud.findMany({
      where: { id: { in: ids } }, orderBy: { id: "asc" },
      include: {
        estadoHistorial: { orderBy: { id: "asc" } },
        documentReviews: { orderBy: { id: "asc" }, include: { decisions: { orderBy: { id: "asc" } } } },
        adjuntos: { orderBy: { id: "asc" } }, desembolso: true, pagoExterno: true,
        documentReviewJob: true, notifications: { orderBy: { id: "asc" } },
      },
    });
    const before = await snapshot();
    async function inbox(status?: SignatureStatus, offset = 0, limit = 50) {
      const start = queries.length;
      const result = await service.inbox(user, status, offset, limit);
      const executed = queries.slice(start);
      assert(executed.length > 0);
      assert(executed.every(query => /^\s*SELECT\b/i.test(query)), "Inbox may only execute SELECT queries");
      return result;
    }

    await t.test("real relation filters exclude reservations, external payments, terminal, archived and unlinked rows", async () => {
      const result = await inbox();
      assert.equal(result.total, 3);
      assert.deepEqual(result.items.map(item => item.solicitudId), [first.id, sent.id, second.id]);
      assert.deepEqual(readerCalls[0], [cancelled.id, first.id, corePaid.id, sent.id, second.id]);
      const excludedBeforeCore = [reserved, external, terminal, archived, unlinked].map(row => row.id);
      assert(excludedBeforeCore.every(id => !readerCalls[0].includes(id)));
      assert.equal(result.items[0].nroSolicitud, null);
      assert.equal(result.items[0].status, "waiting");
      assert.equal(result.items[0].analysisReady, false);
      assert.equal(result.items[1].status, "to_review");
      assert.equal(result.items[1].completedAttempts, 1);
    });
    await t.test("Core eligibility is applied before status filters, pagination and totals", async () => {
      const result = await inbox("waiting", 1, 1);
      assert.equal(result.total, 2);
      assert.equal(result.offset, 1);
      assert.equal(result.limit, 1);
      assert.deepEqual(result.items.map(item => item.solicitudId), [second.id]);
      const toReview = await inbox("to_review");
      assert.equal(toReview.total, 1);
      assert.deepEqual(toReview.items.map(item => item.solicitudId), [sent.id]);
    });
    await t.test("a failed Core read produces 503 and keeps all stored information unchanged", async () => {
      upstreamUnavailable = true;
      const start = queries.length;
      await assert.rejects(service.inbox(user), error => error instanceof DocumentReviewError && error.statusCode === 503);
      assert(queries.slice(start).every(query => /^\s*SELECT\b/i.test(query)));
      upstreamUnavailable = false;
    });
    await t.test("listing or excluding a loan preserves timestamps, links, reviews, human decisions and state history", async () => {
      const after = await snapshot();
      assert.deepEqual(after, before);
      const preserved = after.find(row => row.id === cancelled.id)!;
      assert.equal(preserved.legacyOid, cancelled.legacyOid);
      assert.equal(preserved.linkFirmaDigital, cancelled.linkFirmaDigital);
      assert.equal(preserved.updatedAt.getTime(), cancelled.updatedAt.getTime());
      assert.equal(preserved.estadoActualId, initial.id);
      assert.equal(preserved.estadoHistorial.length, 1);
      assert.equal(preserved.documentReviews.length, 1);
      assert.equal(preserved.documentReviews[0].decisions.length, 1);
      assert.equal(preserved.documentReviews[0].decisions[0].reason, "Historical decision must remain intact");
    });
    // Immutable review/decision records intentionally cannot be deleted. Roll
    // back the whole fixture transaction instead of bypassing their protection.
    throw rollback;
  }, { timeout: 30000 }), error => error === rollback);
  assert.equal(await db.solicitud.count({ where: { id: { in: ids } } }), 0);
  assert.equal(await db.user.count({ where: { id: actorId } }), 0);
});
