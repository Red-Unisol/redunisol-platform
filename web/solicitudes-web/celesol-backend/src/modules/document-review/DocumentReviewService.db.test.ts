import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import type { AuthUser } from "../auth/domain/entities/User.entity";
import { DocumentReviewService } from "./DocumentReviewService";
import { createDocumentReviewWorkflow } from "./workflow";
import { candidateFixture } from "./fixtures";
import { REVIEW_STATE, type ProviderCandidate } from "./domain";

const url = process.env.BEEX_TEST_DATABASE_URL;
test(
  "document review: human gate, immutable audit, any-good signature, overrides, stale checks and atomic workflow",
  { skip: !url },
  async (t) => {
    const parsed = new URL(url!);
    assert(
      ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
        parsed.pathname.endsWith("_test"),
      "Only an explicit local *_test database is allowed",
    );
    const db = new PrismaClient({ datasources: { db: { url } } });
    t.after(() => db.$disconnect());
    const owner = await db.workflowOwner.findUniqueOrThrow({
      where: { code: "RIESGO" },
    });
    const state = await db.workflowState.findUniqueOrThrow({
      where: { code: REVIEW_STATE },
    });
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        legacyUser: randomUUID(),
        passwordHash: "no-login",
        firstName: "Revisor",
        lastName: "de Prueba",
        workflowOwnerId: owner.id,
      },
    });
    const actor: AuthUser = {
      ...user,
      workflowOwner: { id: owner.id, code: owner.code, name: owner.name },
    };
    const outsider = await db.user.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        legacyUser: randomUUID(),
        passwordHash: "no-login",
      },
    });
    const objects = new Map<string, Buffer>();
    let provider: ProviderCandidate[] = [],
      storageFails = false,
      workflowFails = false;
    const workflow = createDocumentReviewWorkflow(db);
    const service = new DocumentReviewService({
      db,
      bucket: "test-bucket",
      maxPdfBytes: 2000000,
      gateway: {
        candidates: async () => structuredClone(provider),
        download: async () => Buffer.from("unused"),
      },
      buildLegajo: async (i) =>
        Buffer.from(
          `%PDF-1.7\n${i.assessment.decision}/${i.human?.decision ?? "pending"}\n%%EOF`,
        ),
      storage: {
        uploadObject: async (i) => {
          if (storageFails) throw new Error("storage unavailable");
          objects.set(i.key, i.body);
        },
        deleteObject: async (i) => {
          objects.delete(i.key);
        },
        getObjectStream: async (i) =>
          Readable.from(objects.get(i.key) ?? Buffer.alloc(0)),
      },
      transition: async (...args) => {
        await workflow(...args);
        if (workflowFails) throw new Error("simulated post-workflow failure");
      },
    });
    let n = 0;
    async function fixture() {
      const loan = `${Date.now()}${++n}`;
      const row = await db.solicitud.create({
        data: {
          legacyOid: loan,
          nroSolicitud: `DOC-TEST-${randomUUID()}`,
          estadoActualId: state.id,
          lineaPrestamoLegacyOid: "1",
          lineaPrestamoDescripcion: "Línea de prueba",
          lineaPrestamoCodigoMutual: "CELESOL",
          montoAFinanciar: "1000.00",
          cuotas: 6,
          cuotaResultante: "200,00",
          firmaDigitalmente: true,
          createdBy: user.id,
          titular: {
            create: {
              nroDocumento: "30123456",
              nombre: "Persona",
              apellidoDenominacion: "de Prueba",
            },
          },
        },
      });
      const good = candidateFixture("good-old");
      good.completedAt = "2026-10-13T12:00:00Z";
      const step = (
        good.resource!.steps as {
          id: string;
          data: {
            signedDocumentDetails?: {
              customVariables: { request: { value: string } };
            }[];
          };
        }[]
      ).find((s) => s.id === "electronic-signature-document-validation")!;
      step.data.signedDocumentDetails![0].customVariables.request.value = loan;
      const bad = structuredClone(good);
      bad.verificationId = "bad-new";
      bad.completedAt = "2026-10-13T15:00:00Z";
      bad.resource!.identity = { status: "reviewNeeded" };
      provider = [bad, good];
      return row;
    }
    const decision = (reviewId: string, approve = true, reason = "") => ({
      reviewId,
      requestId: randomUUID(),
      decision: approve ? ("approve" as const) : ("not_approve" as const),
      verificationId: "good-old",
      reason,
    });

    await t.test(
      "worker prioritizes never-reviewed and oldest due jobs, preventing starvation",
      async () => {
        const otherPending = await db.solicitud.findMany({
          where: { estadoActual: { code: REVIEW_STATE } },
          select: { id: true },
        });
        const tomorrow = new Date(Date.now() + 86400000);
        for (const s of otherPending)
          await db.solicitudDocumentReviewJob.upsert({
            where: { solicitudId: s.id },
            update: { nextCheckAt: tomorrow },
            create: { solicitudId: s.id, nextCheckAt: tomorrow },
          });
        const first = await fixture();
        await db.solicitud.update({
          where: { id: first.id },
          data: { updatedAt: new Date("2020-01-01") },
        });
        await db.solicitudDocumentReviewJob.create({
          data: {
            solicitudId: first.id,
            nextCheckAt: new Date(Date.now() - 60000),
          },
        });
        const neverReviewed = await fixture();
        await service.poll(1);
        assert.equal(
          await db.solicitudDocumentReview.count({
            where: { solicitudId: neverReviewed.id },
          }),
          1,
        );
        assert.equal(
          await db.solicitudDocumentReview.count({
            where: { solicitudId: first.id },
          }),
          0,
        );
        const earlierDue = await fixture();
        await db.solicitudDocumentReviewJob.create({
          data: {
            solicitudId: earlierDue.id,
            nextCheckAt: new Date(Date.now() - 120000),
          },
        });
        await service.poll(1);
        assert.equal(
          await db.solicitudDocumentReview.count({
            where: { solicitudId: earlierDue.id },
          }),
          1,
        );
        assert.equal(
          await db.solicitudDocumentReview.count({
            where: { solicitudId: first.id },
          }),
          0,
        );
      },
    );

    await t.test(
      "system evaluation never advances; older good attempt wins; stable reevaluation is idempotent",
      async () => {
        const row = await fixture(),
          review = await service.evaluate(row.id);
        assert.equal(review.systemDecision, "approve");
        assert.equal(review.selectedVerificationId, "good-old");
        assert.equal(
          (
            await db.solicitud.findUniqueOrThrow({
              where: { id: row.id },
              include: { estadoActual: true },
            })
          ).estadoActual.code,
          REVIEW_STATE,
        );
        assert.equal(
          await db.solicitudDocumentDecision.count({
            where: { reviewId: review.id },
          }),
          0,
        );
        assert.equal((await service.evaluate(row.id)).id, review.id);
        for (const c of provider) {
          const data = (
            c.resource!.steps as {
              id: string;
              data: { signedDocumentDetails?: { pdfDocumentUrl: string }[] };
            }[]
          ).find(
            (s) => s.id === "electronic-signature-document-validation",
          )!.data;
          data.signedDocumentDetails![0].pdfDocumentUrl += "?Expires=999";
        }
        assert.equal(
          (await service.evaluate(row.id)).id,
          review.id,
          "Rotating media credentials do not generate a new observation",
        );
        assert(review.legajoAdjuntoId);
        assert(review.evidencePath);
      },
    );
    await t.test(
      "approval and final legajo share the official workflow transaction; replay preserves one decision",
      async () => {
        const row = await fixture(),
          review = await service.evaluate(row.id),
          input = decision(review.id);
        await service.decide(row.id, actor, input);
        await service.decide(row.id, actor, input);
        const source = await db.solicitud.findUniqueOrThrow({
          where: { id: row.id },
          include: { estadoActual: true },
        });
        assert.equal(source.estadoActual.code, "Transferir");
        const records = await db.solicitudDocumentDecision.findMany({
          where: { reviewId: review.id },
        });
        assert.equal(records.length, 1);
        assert.equal(records[0].humanDecision, "approve");
        assert.equal(records[0].systemDecision, "approve");
        assert(records[0].legajoAdjuntoId);
        assert.equal(records[0].disagreesWithSystem, false);
        assert.equal(
          await db.solicitudEstadoHistorial.count({
            where: {
              solicitudId: row.id,
              actionCode: "transferir",
              changedBy: user.id,
            },
          }),
          1,
        );
        await assert.rejects(() =>
          service.decide(row.id, actor, {
            ...input,
            reason: "different replay",
          }),
        );
      },
    );
    await t.test(
      "human rejection records disparity and returns to Liquidada, preserving the proposed approval",
      async () => {
        const row = await fixture(),
          review = await service.evaluate(row.id),
          input = decision(review.id, false, "Solicitar una nueva firma.");
        await service.decide(row.id, actor, input);
        const record = await db.solicitudDocumentDecision.findUniqueOrThrow({
          where: { requestId: input.requestId },
        });
        assert.equal(record.disagreesWithSystem, true);
        assert.equal(record.systemDecision, "approve");
        assert.equal(record.humanDecision, "not_approve");
        assert(record.legajoAdjuntoId);
        assert.equal(
          (
            await db.solicitud.findUniqueOrThrow({
              where: { id: row.id },
              include: { estadoActual: true },
            })
          ).estadoActual.code,
          "Liquidada",
        );
      },
    );
    await t.test(
      "an additional failed duplicate does not invalidate the selected correct signature",
      async () => {
        const row = await fixture(),
          review = await service.evaluate(row.id);
        const duplicate = structuredClone(provider[0]);
        duplicate.verificationId = "another-bad-duplicate";
        provider.push(duplicate);
        const input = decision(review.id);
        await service.decide(row.id, actor, input);
        const record = await db.solicitudDocumentDecision.findUniqueOrThrow({
          where: { requestId: input.requestId },
        });
        assert.equal(record.verificationId, "good-old");
        assert.equal(
          (record.actingAudit as { attemptsAtDecision: unknown[] })
            .attemptsAtDecision.length,
          3,
        );
      },
    );
    await t.test(
      "overriding a negative proposal or selecting an individually failed attempt needs a reason",
      async () => {
        const row = await fixture();
        provider = provider.filter((c) => c.verificationId === "bad-new");
        const review = await service.evaluate(row.id);
        assert.equal(review.systemDecision, "not_approve");
        const input = { ...decision(review.id), verificationId: "bad-new" };
        await assert.rejects(
          () => service.decide(row.id, actor, input),
          /motivo/,
        );
        await service.decide(row.id, actor, {
          ...input,
          reason: "Evidencia revisada por el responsable.",
        });
        const record = await db.solicitudDocumentDecision.findUniqueOrThrow({
          where: { requestId: input.requestId },
        });
        assert.equal(record.disagreesWithSystem, true);
        assert.equal(record.overridesAttempt, true);
      },
    );
    await t.test(
      "changed financial inputs, foreign attempts and unauthorized actors cannot approve",
      async () => {
        const row = await fixture(),
          review = await service.evaluate(row.id);
        await assert.rejects(
          () =>
            service.decide(
              row.id,
              { ...actor, ...outsider, workflowOwner: null },
              decision(review.id),
            ),
          /permisos/,
        );
        await assert.rejects(
          () =>
            service.decide(row.id, actor, {
              ...decision(review.id),
              verificationId: "foreign",
            }),
          /no pertenece/,
        );
        await db.solicitud.update({
          where: { id: row.id },
          data: { montoAFinanciar: "1001.00" },
        });
        await assert.rejects(
          () => service.decide(row.id, actor, decision(review.id)),
          /solicitud cambió/,
        );
        assert.equal(
          await db.solicitudDocumentDecision.count({
            where: { reviewId: review.id },
          }),
          0,
        );
      },
    );
    await t.test(
      "provider updates invalidate the observed decision, and recovery creates a new immutable observation",
      async () => {
        const row = await fixture(),
          review = await service.evaluate(row.id);
        const original = structuredClone(provider);
        for (const c of provider) c.resource!.identity = { status: "rejected" };
        await assert.rejects(
          () => service.decide(row.id, actor, decision(review.id)),
          /MetaMap cambió/,
        );
        const negative = await service.evaluate(row.id);
        assert.equal(negative.systemDecision, "not_approve");
        provider = original;
        const recovered = await service.evaluate(row.id);
        assert.equal(recovered.systemDecision, "approve");
        assert.notEqual(recovered.id, review.id);
        const view = await service.view(row.id, actor);
        assert.equal(view.currentReview?.id, recovered.id);
      },
    );
    await t.test(
      "storage failures cannot advance, and a later retry preserves failure and recovery separately",
      async () => {
        const row = await fixture();
        storageFails = true;
        const failed = await service.evaluate(row.id);
        assert(failed.artifactError);
        await assert.rejects(
          () => service.decide(row.id, actor, decision(failed.id)),
          /legajo completos/,
        );
        storageFails = false;
        const recovered = await service.evaluate(row.id);
        assert.notEqual(recovered.id, failed.id);
        assert.equal(recovered.artifactError, null);
      },
    );
    await t.test(
      "post-workflow failure rolls back the human decision, attachment and state together",
      async () => {
        const row = await fixture(),
          review = await service.evaluate(row.id);
        workflowFails = true;
        const input = decision(review.id);
        await assert.rejects(
          () => service.decide(row.id, actor, input),
          /simulated/,
        );
        workflowFails = false;
        assert.equal(
          await db.solicitudDocumentDecision.count({
            where: { requestId: input.requestId },
          }),
          0,
        );
        assert.equal(
          (await db.solicitud.findUniqueOrThrow({ where: { id: row.id } }))
            .estadoActualId,
          state.id,
        );
        assert.equal(
          await db.solicitudEstadoHistorial.count({
            where: { solicitudId: row.id, actionCode: "transferir" },
          }),
          0,
        );
      },
    );
    await t.test(
      "audit records and their attachments are immutable at the database boundary",
      async () => {
        const row = await fixture(),
          review = await service.evaluate(row.id);
        await assert.rejects(
          () =>
            db.solicitudDocumentReview.update({
              where: { id: review.id },
              data: { systemDecision: "not_approve" },
            }),
          /IMMUTABLE/,
        );
        await assert.rejects(
          () =>
            db.solicitudAdjunto.update({
              where: { id: review.legajoAdjuntoId! },
              data: { deletedAt: new Date() },
            }),
          /IMMUTABLE/,
        );
      },
    );
  },
);
