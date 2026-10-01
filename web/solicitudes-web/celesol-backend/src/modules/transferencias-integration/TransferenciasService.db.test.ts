import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { TransferenciasService } from "./TransferenciasService";
import { createPayWorkflow } from "./workflow";
import {
  IntegrationError,
  type Actor,
  type Confirmation,
  type FinancialGateway,
  type PaymentPlan,
} from "./domain";

const url = process.env.BEEX_TEST_DATABASE_URL;
const memberCbu = "0000000000000000000001";
const memberCuit = "20123456789";
const pdf = Buffer.from("%PDF-1.7\nSynthetic integration test receipt\n%%EOF");
const audit = { installationId: "test-desktop", operator: "test-operator" };

// No implicit DATABASE_URL fallback: these tests may only use a local test DB.
// Apply migrations before running. No seed or external/bank network calls.
test(
  "PostgreSQL reservation, recovery, freeze and atomic pagar",
  { skip: !url },
  async (t) => {
    const parsed = new URL(url!);
    assert(
      ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
        parsed.pathname.endsWith("_test"),
      "BEEX_TEST_DATABASE_URL must point to a local *_test database",
    );
    const db = new PrismaClient({ datasources: { db: { url } } });
    t.after(() => db.$disconnect());
    const owner = await db.workflowOwner.findUniqueOrThrow({
      where: { code: "TESORERIA" },
    });
    const transfer = await db.workflowState.findUniqueOrThrow({
      where: { code: "Transferir" },
    });
    const paid = await db.workflowState.findUniqueOrThrow({
      where: { code: "Pagada" },
    });
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        legacyUser: randomUUID(),
        passwordHash: "not-a-login-password",
        workflowOwnerId: owner.id,
      },
    });
    const actor: Actor = {
      id: user.id,
      workflowOwnerId: owner.id,
      clientId: "test-client",
    };
    await db.socio.upsert({
      where: { cuit: memberCuit },
      update: {},
      create: {
        cuit: memberCuit,
        tipoPersona: "FISICA",
        nroSocioLegacy: "77",
        nroDocumento: "12345678",
        nombre: "Synthetic",
        apellido: "Member",
        tipoDocumento: "DNI",
        sexo: "M",
        fechaDeNacimiento: new Date("1990-01-01"),
      },
    });
    const financials: FinancialGateway = {
      loan: async (id) => ({
        loanId: id,
        lineId: "12",
        cbu: memberCbu,
        cmf: "0",
        coinag: "1000.01",
        cashInHand: "-1000.01",
        memberCuit,
      }),
      creditor: async () => ({ cuit: "30123456789" }),
    };
    let storageFails = false;
    let failAfterWorkflow = false;
    const objects = new Map<string, Buffer>();
    const pay = createPayWorkflow(db);
    const deps = {
      db,
      financials,
      bucket: "test-receipts",
      storage: {
        uploadObject: async (input: { key: string; body: Buffer }) => {
          if (storageFails) throw new Error("storage unavailable");
          objects.set(input.key, input.body);
        },
        deleteObject: async () => {
          throw new Error("Must not delete on retry");
        },
        getObjectStream: async (): Promise<NodeJS.ReadableStream> => {
          throw new Error("unused");
        },
      },
      pay: async (...args: Parameters<typeof pay>) => {
        await pay(...args);
        if (failAfterWorkflow)
          throw new Error("simulated failure after workflow");
      },
    };
    let counter = 0;
    async function fixture() {
      const source = await db.solicitud.create({
        data: {
          legacyOid: `${Date.now()}${counter++}`,
          nroSolicitud: randomUUID(),
          estadoActualId: transfer.id,
          lineaPrestamoLegacyOid: "99",
          lineaPrestamoDescripcion: "Synthetic line",
          montoAFinanciar: "1000.01",
          firmaDigitalmente: true,
          createdBy: actor.id,
          titular: {
            create: {
              cuit: "20-12345678-9",
              nroDocumento: "12.345.678",
              cbu: memberCbu,
              nombre: "Synthetic",
              apellidoDenominacion: "Member",
            },
          },
        },
      });
      const service = new TransferenciasService(deps);
      const plan = await service.plan(source.id);
      const input = {
        ...audit,
        idempotencyKey: randomUUID(),
        planVersion: plan.version,
        verificationId: randomUUID(),
        payments: plan.payments.map((p) => ({
          paymentKey: p.paymentKey,
          bankTransactionId: randomUUID(),
        })),
      };
      return { source, service, plan, input };
    }
    const evidence = (
      plan: PaymentPlan,
      bankTransactionId: string,
    ): Confirmation => ({
      ...audit,
      bankTransactionId,
      bankOperationId: randomUUID(),
      currency: "ARS",
      amount: plan.payments[0]!.amount,
      cbu: memberCbu,
      cuit: memberCuit,
      confirmedAt: "2026-01-01T00:00:00Z",
    });

    await t.test(
      "concurrent identical reservations and lost-response lookup return same order",
      async () => {
        const { source, service, plan, input } = await fixture();
        const [a, b] = await Promise.all([
          service.reserve(source.id, input, actor),
          service.reserve(source.id, input, actor),
        ]);
        assert.equal(a.id, b.id);
        assert.equal(
          (await service.byKey(input.idempotencyKey, actor)).id,
          a.id,
        );
        assert.equal(
          (await new TransferenciasService(deps).get(a.id, actor)).payments[0]
            ?.bankTransactionId,
          input.payments[0]?.bankTransactionId,
        );
        await assert.rejects(
          service.reserve(
            source.id,
            { ...input, operator: "different" },
            actor,
          ),
          IntegrationError,
        );
        await assert.rejects(
          service.get(a.id, { ...actor, clientId: "different" }),
          IntegrationError,
        );
        assert.equal((await service.revalidate(a.id, actor)).valid, true);
        const originalLoan = financials.loan;
        financials.loan = async (...args) => ({
          ...(await originalLoan(...args)),
          coinag: "900",
        });
        await assert.rejects(
          service.revalidate(a.id, actor),
          (e: unknown) =>
            e instanceof IntegrationError && e.code === "PLAN_CHANGED",
        );
        financials.loan = originalLoan;

        await assert.rejects(
          db.solicitud.update({
            where: { id: source.id },
            data: { montoAFinanciar: "2" },
          }),
          /BEEX_TRANSFERENCIAS_LOCKED/,
        );
        await assert.rejects(
          db.solicitudTitular.update({
            where: { solicitudId: source.id },
            data: { cbu: "0000000000000000000002" },
          }),
          /BEEX_TRANSFERENCIAS_LOCKED/,
        );
        await assert.rejects(
          db.solicitudCancelacion.create({
            data: {
              solicitudId: source.id,
              cbu: memberCbu,
              monto: "1",
              socio: "test",
              cuentaADebitar: "test",
              cuentaBancaria: "test",
            },
          }),
          /BEEX_TRANSFERENCIAS_LOCKED/,
        );
        await assert.rejects(
          db.solicitud.update({
            where: { id: source.id },
            data: { estadoActualId: paid.id },
          }),
          /BEEX_TRANSFERENCIAS_LOCKED/,
        );

        await assert.rejects(
          service.receipt(a.id, pdf, actor),
          IntegrationError,
        );
        const confirmation = evidence(
          plan,
          input.payments[0]!.bankTransactionId,
        );
        await assert.rejects(
          service.confirm(
            a.id,
            "member",
            { ...confirmation, amount: "1000.00" },
            actor,
          ),
          IntegrationError,
        );
        const result = await service.confirm(
          a.id,
          "member",
          confirmation,
          actor,
        );
        assert.equal(result.status, "BANK_CONFIRMED_PENDING_SYNC");
        assert.equal(
          (await service.confirm(a.id, "member", confirmation, actor)).status,
          result.status,
        );
        await assert.rejects(
          service.confirm(
            a.id,
            "member",
            { ...confirmation, bankOperationId: randomUUID() },
            actor,
          ),
          IntegrationError,
        );

        storageFails = true;
        await assert.rejects(
          service.receipt(a.id, pdf, actor),
          /storage unavailable/,
        );
        storageFails = false;
        failAfterWorkflow = true;
        await assert.rejects(
          service.receipt(a.id, pdf, actor),
          /simulated failure/,
        );
        failAfterWorkflow = false;
        assert.equal(
          (await db.solicitud.findUniqueOrThrow({ where: { id: source.id } }))
            .estadoActualId,
          transfer.id,
        );
        assert.equal(
          await db.solicitudAdjunto.count({
            where: { solicitudId: source.id },
          }),
          0,
        );
        assert.equal(
          await db.solicitudEstadoHistorial.count({
            where: { solicitudId: source.id },
          }),
          0,
        );
        assert.equal(
          (await service.get(a.id, actor)).status,
          "BANK_CONFIRMED_PENDING_SYNC",
        );

        const completed = await Promise.all([
          service.receipt(a.id, pdf, actor),
          service.receipt(a.id, pdf, actor),
        ]);
        assert.equal(completed[0]!.status, "COMPLETED");
        assert.deepEqual(completed[0]!.receipt, completed[1]!.receipt);
        assert.equal(
          await db.solicitudAdjunto.count({
            where: { solicitudId: source.id },
          }),
          1,
        );
        assert.equal(
          await db.solicitudEstadoHistorial.count({
            where: { solicitudId: source.id, actionCode: "pagar" },
          }),
          1,
        );
        assert.equal(objects.size, 1);
        const history = await db.solicitudEstadoHistorial.findFirstOrThrow({
          where: { solicitudId: source.id },
        });
        assert.equal(history.changedBy, actor.id);
        assert.match(history.comentario!, /test-operator/);
        assert.equal(
          (await service.reserve(source.id, input, actor)).status,
          "COMPLETED",
        );
        await assert.rejects(
          service.receipt(a.id, Buffer.from("%PDF-1.7\nother\n%%EOF"), actor),
          IntegrationError,
        );
        await assert.rejects(
          db.solicitudAdjunto.update({
            where: { id: completed[0]!.receipt!.adjuntoId },
            data: { deletedAt: new Date() },
          }),
          /BEEX_TRANSFERENCIAS_LOCKED/,
        );
      },
    );

    await t.test(
      "different concurrent reservation keys cannot both win; bank IDs cannot be recycled",
      async () => {
        const { source, service, input } = await fixture();
        const outcomes = await Promise.allSettled([
          service.reserve(source.id, input, actor),
          service.reserve(
            source.id,
            { ...input, idempotencyKey: randomUUID() },
            actor,
          ),
        ]);
        assert.equal(
          outcomes.filter((o) => o.status === "fulfilled").length,
          1,
        );
        assert.equal(outcomes.filter((o) => o.status === "rejected").length, 1);
        const next = await fixture();
        await assert.rejects(
          service.reserve(
            next.source.id,
            {
              ...next.input,
              payments: input.payments,
            },
            actor,
          ),
          (e: unknown) =>
            e instanceof IntegrationError && e.code === "RESERVATION_CONFLICT",
        );
      },
    );

    await t.test(
      "stale plans and incomplete verification cannot reserve",
      async () => {
        const { source, service, input } = await fixture();
        await assert.rejects(
          service.reserve(source.id, { ...input, verificationId: null }, actor),
          IntegrationError,
        );
        await assert.rejects(
          service.reserve(source.id, { ...input, payments: [] }, actor),
          IntegrationError,
        );
        await db.solicitudTitular.update({
          where: { solicitudId: source.id },
          data: { nombre: "Changed" },
        });
        await assert.rejects(
          service.reserve(source.id, input, actor),
          (e: unknown) =>
            e instanceof IntegrationError && e.code === "PLAN_CHANGED",
        );
      },
    );

    await t.test(
      "partial creditor payout resumes and competing PDFs cannot replace the winning receipt",
      async () => {
        const { source, service, input } = await fixture();
        const cancellation = await db.solicitudCancelacion.create({
          data: {
            solicitudId: source.id,
            cbu: "0000000000000000000002",
            monto: "600.01",
            socio: "Synthetic creditor",
            socioLegacyId: "88",
            cuentaADebitar: "test",
            cuentaBancaria: "test",
          },
        });
        const originalLoan = financials.loan;
        financials.loan = async (...args) => ({
          ...(await originalLoan(...args)),
          cashInHand: "-400",
        });
        try {
          const plan = await service.plan(source.id);
          const order = await service.reserve(
            source.id,
            {
              ...input,
              planVersion: plan.version,
              payments: plan.payments.map((p) => ({
                paymentKey: p.paymentKey,
                bankTransactionId: randomUUID(),
              })),
            },
            actor,
          );
          const creditor = order.payments.find(
            (p) => p.paymentKey === `creditor:${cancellation.id}`,
          )!;
          const creditorEvidence: Confirmation = {
            ...audit,
            bankTransactionId: creditor.bankTransactionId,
            bankOperationId: randomUUID(),
            amount: "600.01",
            cbu: cancellation.cbu,
            cuit: "30123456789",
            currency: "ARS",
            confirmedAt: "2026-01-01T00:00:00Z",
          };
          assert.equal(
            (
              await service.confirm(
                order.id,
                creditor.paymentKey,
                creditorEvidence,
                actor,
              )
            ).status,
            "RESERVED",
          );
          assert.equal(
            (
              await new TransferenciasService(deps).get(order.id, actor)
            ).payments.filter((p) => p.confirmedAt).length,
            1,
          );
          await assert.rejects(
            service.receipt(order.id, pdf, actor),
            IntegrationError,
          );
          const member = order.payments.find((p) => p.paymentKey === "member")!;
          const memberEvidence = evidence(plan, member.bankTransactionId);
          await assert.rejects(
            service.confirm(
              order.id,
              "member",
              {
                ...memberEvidence,
                bankOperationId: creditorEvidence.bankOperationId,
              },
              actor,
            ),
            (e: unknown) =>
              e instanceof IntegrationError &&
              e.code === "BANK_OPERATION_CONFLICT",
          );
          await service.confirm(order.id, "member", memberEvidence, actor);
          const otherPdf = Buffer.from(
            "%PDF-1.7\nCompeting synthetic PDF\n%%EOF",
          );
          const outcomes = await Promise.allSettled([
            service.receipt(order.id, pdf, actor),
            service.receipt(order.id, otherPdf, actor),
          ]);
          assert.equal(
            outcomes.filter((o) => o.status === "fulfilled").length,
            1,
          );
          assert.equal(
            outcomes.filter((o) => o.status === "rejected").length,
            1,
          );
          const saved = await service.get(order.id, actor);
          assert.equal(saved.status, "COMPLETED");
          const adjunto = await db.solicitudAdjunto.findUniqueOrThrow({
            where: { id: saved.receipt!.adjuntoId },
          });
          const winnerIndex = outcomes.findIndex(
            (o) => o.status === "fulfilled",
          );
          assert.deepEqual(
            objects.get(adjunto.archivoPath!),
            [pdf, otherPdf][winnerIndex],
          );
        } finally {
          financials.loan = originalLoan;
        }
      },
    );
  },
);
