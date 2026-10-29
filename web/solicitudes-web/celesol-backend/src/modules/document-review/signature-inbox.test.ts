import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient, type SolicitudDocumentReview } from "@prisma/client";
import type { AuthUser } from "../auth/domain/entities/User.entity";
import type { CoreLoanLifecycle } from "../solicitudes-core/infrastructure/services/ControlledLoanReplacementService";
import type { SignatureInboxLoanState } from "../solicitudes/infrastructure/services/EvaluateListSolicitudesGateway";
import { DocumentReviewService } from "./DocumentReviewService";
import { assess, digest, DocumentReviewError } from "./domain";
import { candidateFixture } from "./fixtures";
import { reviewSource, type SignatureSourceRow } from "./signature-workflow";

type Dependencies = ConstructorParameters<typeof DocumentReviewService>[0];
type LoanReader = NonNullable<Dependencies["inboxLoanStates"]>;
type InboxRow = SignatureSourceRow & {
  vendedor: { firstName: string | null; lastName: string | null; legacyUser: string } | null;
  creator: { firstName: string | null; lastName: string | null; legacyUser: string };
};
type ReadCall = { operation: string; args: unknown };

const reviewer = {
  id: "legajos-user", isSystemAdmin: false,
  workflowOwner: { code: "LEGAJOS_DIGITALES" },
} as AuthUser;

function row(id: string, patch: Partial<InboxRow> = {}): InboxRow {
  return {
    id, nroSolicitud: `SOL-${id}`, legacyOid: `loan-${id}`,
    signatureCycleId: null, signatureRequestedAt: null, signatureRequestReason: null,
    signatureExcludedVerificationIds: null, analisisFinalizadoAt: null,
    archivedAt: null, desembolso: null, pagoExterno: null,
    estadoActual: { code: "Confirmada", isTerminal: false },
    lineaPrestamoDescripcion: "Test", lineaPrestamoCodigoMutual: "CELESOL",
    montoAFinanciar: new Prisma.Decimal("1000"), cuotas: 6, cuotaResultante: "200,00",
    linkFirmaDigital: `https://example.invalid/sign/loan-${id}`,
    titular: { nombre: "Persona", apellidoDenominacion: "de Prueba", nroDocumento: "30123456" },
    vendedor: { firstName: "Vendedora", lastName: "de Prueba", legacyUser: "seller" },
    creator: { firstName: null, lastName: null, legacyUser: "original-creator" },
    ...patch,
  } as InboxRow;
}

function lifecycle(id: string | null, patch: Partial<CoreLoanLifecycle> = {}): CoreLoanLifecycle {
  return {
    id, account: id, estado: 0, estadoLabel: "Activo", estadoPrestamo: 0,
    estadoPrestamoLabel: "Vigente", vigente: true, saldo: 1000,
    ...patch,
  };
}

function activeStates(rows: SignatureSourceRow[]): ReadonlyMap<string, SignatureInboxLoanState> {
  return new Map(rows.map(source => [source.id, {
    lifecycle: lifecycle(source.legacyOid!), transferred: false,
  }]));
}

function review(source: SignatureSourceRow): SolicitudDocumentReview {
  return {
    id: `review-${source.id}`, solicitudId: source.id,
    sourceFingerprint: digest(reviewSource(source)),
    assessment: assess(reviewSource(source), [candidateFixture()]),
  } as unknown as SolicitudDocumentReview;
}

function harness(rows: InboxRow[], options: {
  reader?: LoanReader | null;
  reviews?: SolicitudDocumentReview[];
} = {}) {
  const calls: ReadCall[] = [];
  const readerCalls: SignatureSourceRow[][] = [];
  const trace: string[] = [];
  const reads: Record<string, (args: unknown) => unknown> = {
    "solicitud.findMany": () => rows,
    "solicitudDocumentReview.findMany": () => options.reviews ?? [],
    "solicitudDocumentDecision.findMany": () => [],
  };
  // Every operation must be one of these reads. A future mutation, transaction,
  // or evidence fetch fails instead of being silently accepted by the fake.
  const database = new Proxy({}, {
    get(_target, model: string) {
      if (model.startsWith("$")) return () => assert.fail(`Unexpected database operation: ${model}`);
      return new Proxy({}, {
        get(_delegate, method: string) {
          return async (args: unknown) => {
            const operation = `${model}.${method}`;
            calls.push({ operation, args });
            trace.push(operation);
            assert.ok(reads[operation], `Unexpected database operation: ${operation}`);
            return reads[operation](args);
          };
        },
      });
    },
  }) as PrismaClient;
  const reader: LoanReader | undefined = options.reader === null ? undefined : async candidates => {
    readerCalls.push(candidates);
    trace.push("loanStates");
    return options.reader ? options.reader(candidates) : activeStates(candidates);
  };
  const deps: Dependencies = {
    db: database, inboxLoanStates: reader,
    gateway: {
      candidates: async () => assert.fail("Inbox must not fetch signature evidence"),
      download: async () => assert.fail("Inbox must not download evidence"),
    },
    storage: {} as Dependencies["storage"], bucket: "test", maxPdfBytes: 1000,
    buildLegajo: async () => assert.fail("Inbox must not build a legajo"),
    transition: async () => assert.fail("Inbox must not change the workflow"),
  };
  return { service: new DocumentReviewService(deps), calls, readerCalls, trace };
}

function assertUnavailable(error: unknown) {
  assert.ok(error instanceof DocumentReviewError);
  assert.equal(error.statusCode, 503);
  assert.match(error.message, /Vimarx/);
  return true;
}

function summaryIds(calls: ReadCall[]) {
  const query = calls.find(call => call.operation === "solicitudDocumentReview.findMany");
  return (query?.args as { where: { OR: { solicitudId: string }[] } } | undefined)
    ?.where.OR.map(match => match.solicitudId);
}

test("signature inbox checks Legajos permissions before reading applications or external loan states", async () => {
  const h = harness([row("private")]);
  const seller = { ...reviewer, workflowOwner: { code: "VENDEDORES" } } as AuthUser;
  await assert.rejects(h.service.inbox(seller), error => {
    assert.ok(error instanceof DocumentReviewError);
    assert.equal(error.statusCode, 403);
    return true;
  });
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.readerCalls, []);
});

test("an empty signature inbox does not require or invoke an external loan reader", async () => {
  const withoutReader = harness([], { reader: null });
  assert.deepEqual(await withoutReader.service.inbox(reviewer), {
    items: [], total: 0, offset: 0, limit: 50,
  });
  assert.deepEqual(withoutReader.calls.map(call => call.operation), ["solicitud.findMany"]);
  const failingReader = harness([], { reader: async () => assert.fail("Empty inbox must not query Vimarx") });
  assert.equal((await failingReader.service.inbox(reviewer)).total, 0);
  assert.deepEqual(failingReader.readerCalls, []);
});

test("active loans remain visible while analysis is pending, including historical applications without a number", async () => {
  const historical = row("historical", {
    nroSolicitud: null, vendedor: null, linkFirmaDigital: null,
    estadoActual: { code: "CargaVendedor", isTerminal: false } as InboxRow["estadoActual"],
  });
  const confirmed = row("confirmed");
  const h = harness([historical, confirmed]);
  const result = await h.service.inbox(reviewer);
  assert.equal(result.total, 2);
  assert.deepEqual(result.items.map(item => ({
    id: item.solicitudId, status: item.status, attempts: item.completedAttempts, ready: item.analysisReady,
  })), [
    { id: "historical", status: "waiting", attempts: 0, ready: false },
    { id: "confirmed", status: "waiting", attempts: 0, ready: false },
  ]);
  assert.equal(result.items[0].nroSolicitud, null);
  assert.equal(result.items[0].vendedor, "original-creator");
  assert.equal(result.items[1].vendedor, "Vendedora de Prueba");
  assert.deepEqual(h.readerCalls[0].map(source => source.id), ["historical", "confirmed"]);
  const query = h.calls[0].args as Prisma.SolicitudFindManyArgs;
  assert.deepEqual(query.where, {
    legacyOid: { not: null }, archivedAt: null, estadoActual: { isTerminal: false },
    desembolso: null, pagoExterno: null,
  });
  assert.deepEqual(h.trace, [
    "solicitud.findMany", "loanStates", "solicitudDocumentReview.findMany", "solicitudDocumentDecision.findMany",
  ]);
});

test("Beex reservations, external payments, archived and terminal applications are excluded before consulting Vimarx", async () => {
  const eligible = row("eligible");
  // Return overbroad rows deliberately: eligibility must also be defended after
  // the DB query, rather than relying on the query alone.
  const rows = [
    row("reserved", { desembolso: { id: "reservation" } }),
    row("external", { pagoExterno: { id: "external-payment" } }),
    row("archived", { archivedAt: new Date("2026-10-01T12:00:00Z") }),
    row("terminal", { estadoActual: { code: "Pagada", isTerminal: true } as InboxRow["estadoActual"] }),
    row("unlinked", { legacyOid: null }), eligible,
  ];
  const h = harness(rows);
  assert.deepEqual((await h.service.inbox(reviewer)).items.map(item => item.solicitudId), [eligible.id]);
  assert.deepEqual(h.readerCalls[0].map(source => source.id), [eligible.id]);
  assert.deepEqual(summaryIds(h.calls), [eligible.id]);
});

test("cancelled or non-open Vimarx loans never enter the signature inbox", async t => {
  const cases: { name: string; patch: Partial<CoreLoanLifecycle> }[] = [
    { name: "nonzero general state", patch: { estado: 1 } },
    { name: "negative general state", patch: { estado: -1 } },
    { name: "general label Anulado despite state zero", patch: { estadoLabel: "Anulado" } },
    { name: "general label Anulada despite state zero", patch: { estadoLabel: " Anulada " } },
    { name: "loan label Anulado despite state zero", patch: { estadoPrestamoLabel: "ANULADO" } },
    { name: "loan label Anulada despite state zero", patch: { estadoPrestamoLabel: "Anulada" } },
  ];
  for (const { name, patch } of cases) await t.test(name, async () => {
    const source = row("cancelled");
    const h = harness([source], { reader: async () => new Map([[source.id, {
      lifecycle: lifecycle(source.legacyOid!, patch), transferred: false,
    }]]) });
    const result = await h.service.inbox(reviewer);
    assert.deepEqual(result.items, []);
    assert.equal(result.total, 0);
    assert.equal(summaryIds(h.calls), undefined);
  });
});

test("a transfer confirmed by Vimarx excludes the loan even when lifecycle details are unavailable", async t => {
  for (const loan of [lifecycle("already-paid"), null]) await t.test(loan ? "active-looking lifecycle" : "missing historical lifecycle", async () => {
    const source = row("already-paid");
    const h = harness([source], { reader: async () => new Map([[source.id, {
      lifecycle: loan, transferred: true,
    }]]) });
    assert.equal((await h.service.inbox(reviewer)).total, 0);
    assert.equal(summaryIds(h.calls), undefined);
  });
});

test("financial eligibility precedes signature status filters, pagination and totals", async () => {
  const cancelled = row("cancelled"), first = row("waiting-first"), paid = row("paid");
  const sent = row("sent"), second = row("waiting-second");
  const rows = [cancelled, first, paid, sent, second];
  const reader: LoanReader = async sources => new Map(sources.map(source => [source.id, {
    lifecycle: lifecycle(source.legacyOid!, source.id === cancelled.id ? { estadoLabel: "Anulado" } : {}),
    transferred: source.id === paid.id,
  }]));
  const all = harness(rows, { reader, reviews: [review(sent)] });
  const allResult = await all.service.inbox(reviewer);
  assert.equal(allResult.total, 3);
  assert.deepEqual(allResult.items.map(item => item.solicitudId), [first.id, sent.id, second.id]);
  assert.equal(allResult.items[1].status, "to_review");
  assert.equal(allResult.items[1].completedAttempts, 1);
  assert.deepEqual(summaryIds(all.calls), [first.id, sent.id, second.id]);

  const filtered = harness(rows, { reader, reviews: [review(sent)] });
  const page = await filtered.service.inbox(reviewer, "waiting", 1, 1);
  assert.equal(page.total, 2);
  assert.equal(page.offset, 1);
  assert.equal(page.limit, 1);
  assert.deepEqual(page.items.map(item => item.solicitudId), [second.id]);
  assert.deepEqual(summaryIds(filtered.calls), [first.id, sent.id, second.id]);

  const toReview = harness(rows, { reader, reviews: [review(sent)] });
  assert.deepEqual((await toReview.service.inbox(reviewer, "to_review")).items.map(item => item.solicitudId), [sent.id]);
});

test("unverifiable Vimarx states fail with 503 instead of hiding loans as an empty or partial inbox", async t => {
  const good = row("good"), unknown = row("unknown");
  const malformed: { name: string; value?: SignatureInboxLoanState; throws?: boolean; noReader?: boolean }[] = [
    { name: "reader not configured", noReader: true },
    { name: "reader throws", throws: true },
    { name: "missing loan entry" },
    { name: "null lifecycle", value: { lifecycle: null, transferred: false } },
    { name: "missing loan identity", value: { lifecycle: lifecycle(null), transferred: false } },
    { name: "null general state", value: { lifecycle: lifecycle("unknown", { estado: null }), transferred: false } },
    { name: "string general state", value: { lifecycle: lifecycle("unknown", { estado: "0" as unknown as number }), transferred: false } },
    { name: "noninteger general state", value: { lifecycle: lifecycle("unknown", { estado: 0.5 }), transferred: false } },
    { name: "NaN general state", value: { lifecycle: lifecycle("unknown", { estado: Number.NaN }), transferred: false } },
    { name: "infinite general state", value: { lifecycle: lifecycle("unknown", { estado: Number.POSITIVE_INFINITY }), transferred: false } },
    { name: "missing transfer status", value: { lifecycle: lifecycle("unknown") } as SignatureInboxLoanState },
    { name: "string transfer status", value: { lifecycle: lifecycle("unknown"), transferred: "false" as unknown as boolean } },
  ];
  for (const scenario of malformed) await t.test(scenario.name, async () => {
    const h = harness([good, unknown], { reader: scenario.noReader ? null : async () => {
      if (scenario.throws) throw new Error("Vimarx unavailable");
      const states = new Map<string, SignatureInboxLoanState>([[good.id, {
        lifecycle: lifecycle(good.legacyOid!), transferred: false,
      }]]);
      if (scenario.value) states.set(unknown.id, scenario.value);
      return states;
    } });
    await assert.rejects(h.service.inbox(reviewer, "waiting", 0, 1), assertUnavailable);
    assert.equal(summaryIds(h.calls), undefined, "Do not return partial data or summarize before eligibility is known");
  });
});

test("excluding a cancelled loan is read-only and retains its loan link, signature history and application state", async () => {
  const source = Object.assign(row("cancelled-history"), {
    estadoHistorial: [{ actionCode: "confirmar", comment: "Historical transition" }],
    documentReviews: [{ id: "old-review", sourceFingerprint: "historical-fingerprint" }],
    loanReplacements: [{ previousLoanId: "old-loan", newLoanId: "loan-cancelled-history" }],
  });
  const before = JSON.stringify(source);
  Object.freeze(source.estadoHistorial[0]);
  Object.freeze(source.documentReviews[0]);
  Object.freeze(source.loanReplacements[0]);
  Object.freeze(source.estadoActual);
  Object.freeze(source);
  const h = harness([source], { reader: async () => new Map([[source.id, {
    lifecycle: lifecycle(source.legacyOid!, { estadoLabel: "Anulado" }), transferred: false,
  }]]) });
  assert.equal((await h.service.inbox(reviewer)).total, 0);
  assert.equal(JSON.stringify(source), before);
  assert.equal(source.legacyOid, "loan-cancelled-history");
  assert.equal(source.linkFirmaDigital, "https://example.invalid/sign/loan-cancelled-history");
  assert.deepEqual(h.calls.map(call => call.operation), ["solicitud.findMany"]);
});
