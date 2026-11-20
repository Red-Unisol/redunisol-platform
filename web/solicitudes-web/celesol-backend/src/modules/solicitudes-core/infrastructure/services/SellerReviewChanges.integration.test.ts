import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { SolicitudWorkflowEngine } from "../../domain/workflow/SolicitudWorkflowEngine";
import { SolicitudWorkflowPrismaDatasource } from "../datasources/SolicitudWorkflowPrismaDatasource";
import { SolicitudesCorePrismaDatasource } from "../datasources/SolicitudesCorePrismaDatasource";

const databaseUrl = process.env.BEEX_TEST_DATABASE_URL;
const db = new PrismaClient({ datasourceUrl: databaseUrl });
after(() => db.$disconnect());

it("entrega únicamente diferencias netas de Vendedores en cada reingreso a Riesgo", { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl!);
  assert(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.endsWith("_test"));
  const [riskState, sellerState] = await Promise.all(["RevisionRiesgo", "Revisar"].map(code =>
    db.workflowState.findUniqueOrThrow({ where: { code } }),
  ));
  const makeUser = (workflowOwnerId: string) => db.user.create({ data: {
    email: `${randomUUID()}@example.test`, legacyUser: randomUUID(), passwordHash: "test", workflowOwnerId,
  } });
  const [risk, seller] = await Promise.all([makeUser(riskState.ownerId), makeUser(sellerState.ownerId)]);
  const row = await db.solicitud.create({ data: {
    createdBy: seller.id, assignedToUserId: risk.id, estadoActualId: riskState.id,
    lineaPrestamoLegacyOid: "1", lineaPrestamoDescripcion: "Prueba",
    titular: { create: { nroDocumento: "12345", celular: "original", email: "original@example.test" } },
    datosLaborales: { create: { empleador: "Original" } },
  } });
  const repository = new SolicitudesCorePrismaDatasource(db);
  const engine = new SolicitudWorkflowEngine({ repository: new SolicitudWorkflowPrismaDatasource(db) });
  const transition = (actionCode: string, user: typeof seller) => engine.execute({
    actionCode, solicitudId: row.id, changedBy: user.id, workflowOwnerId: user.workflowOwnerId!, now: new Date(), comment: "Prueba",
  });
  const detail = () => repository.findById(row.id, { withSellerReviewChanges: true });
  const guard = { expectedEstadoActualId: sellerState.id, enforceMontoAprobadoRiesgo: true };
  try {
    assert.equal((await detail())?.sellerReviewChanges, undefined);
    await transition("revisar", risk);
    await repository.update(row.id, {
      titular: { celular: "intermedio", email: "vendedor@example.test" }, datosLaborales: { empleador: "Temporal" },
    }, { ...guard, sellerReviewActor: "seller" });
    await repository.update(row.id, { titular: { celular: "definitivo" }, datosLaborales: { empleador: "Original" } },
      { ...guard, sellerReviewActor: "seller" });
    await repository.update(row.id, { titular: { email: "riesgo@example.test", domicilioCalle: "Corrigió Riesgo" } },
      { ...guard, sellerReviewActor: "other" });
    assert.equal((await detail())?.sellerReviewChanges, undefined);

    await transition("revisar_reenviar", seller);
    const expected = [{ field: "titular.celular", before: "original", after: "definitivo" }];
    assert.deepEqual((await detail())?.sellerReviewChanges, expected);
    assert.equal((await repository.findById(row.id))?.sellerReviewChanges, undefined);
    const receipt = await db.solicitudEstadoHistorial.findFirstOrThrow({
      where: { solicitudId: row.id, actionCode: "revisar_reenviar" },
    });
    assert.deepEqual(receipt.metadata, { sellerReviewChanges: expected });
    const publicHistory = await new SolicitudWorkflowPrismaDatasource(db).listHistory({
      solicitudId: row.id, currentUser: { id: seller.id, workflowOwnerId: seller.workflowOwnerId },
    });
    const publicReceipt = publicHistory.find(item => item.id === receipt.id);
    assert(publicReceipt);
    assert(!Object.hasOwn(publicReceipt, "metadata") && !Object.hasOwn(publicReceipt, "sellerReviewChanges"));
    await transition("evaluacion_externa", risk);
    assert.deepEqual((await detail())?.sellerReviewChanges, expected);
    await transition("volver_a_revision_riesgo", risk);
    await transition("preaprobar", risk);
    await transition("revisar_monto_cuota", seller);
    assert.equal((await detail())?.sellerReviewChanges, undefined);

    await transition("preaprobar", risk);
    const preapproved = await db.workflowState.findUniqueOrThrow({ where: { code: "PreAprobada" } });
    const preapprovalGuard = { ...guard, expectedEstadoActualId: preapproved.id, sellerReviewActor: "seller" as const };
    await repository.update(row.id, { titular: { localidad: "San Martín", localidadId: "A" } }, preapprovalGuard);
    await repository.update(row.id, { titular: { localidad: "San Martín", localidadId: "B" } }, preapprovalGuard);
    await transition("confirmar", seller);
    assert.deepEqual((await detail())?.sellerReviewChanges, [
      { field: "titular.localidad", before: null, after: "San Martín (B)" },
    ]);
  } finally {
    await db.solicitudEstadoHistorial.deleteMany({ where: { solicitudId: row.id } });
    await db.solicitud.delete({ where: { id: row.id } });
    await db.user.deleteMany({ where: { id: { in: [risk.id, seller.id] } } });
  }
});
