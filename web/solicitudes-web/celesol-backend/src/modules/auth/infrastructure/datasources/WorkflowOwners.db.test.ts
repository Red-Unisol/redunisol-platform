import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { activeWorkflowAreaWhere } from "../../domain/workflow-areas";
import { AuthPrismaDatasource } from "./AuthPrismaDatasource";

const url = process.env.BEEX_TEST_DATABASE_URL;

it("reemplaza roles, conserva asignaciones y revoca accesos en la próxima consulta", { skip: !url }, async () => {
  const target = new URL(url!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname.endsWith("_test"));
  const db = new PrismaClient({ datasources: { db: { url } } });
  const ds = new AuthPrismaDatasource(db);
  const userId = randomUUID();
  try {
    const owner = Object.fromEntries((await db.workflowOwner.findMany({
      where: { code: { in: ["VENDEDORES", "RIESGO", "TESORERIA", "LEGAJOS_DIGITALES"] }, isActive: true },
    })).map(o => [o.code, o.id]));
    const riskState = await db.workflowState.findFirstOrThrow({
      where: { isTerminal: false, ownerId: owner.RIESGO },
    });
    await db.user.create({ data: {
      id: userId, email: `${userId}@example.test`, legacyUser: userId,
      passwordHash: "test-only", workflowOwnerId: owner.TESORERIA, state: 1,
    } });
    assert.equal(await db.userWorkflowOwner.count({ where: { userId } }), 1);
    const grant = (workflowOwnerIds: string[]) => ds.assignWorkflowOwner({ userId, workflowOwnerIds });
    const all = [owner.RIESGO, owner.LEGAJOS_DIGITALES, owner.TESORERIA];
    const granted = await grant(all);
    assert.equal(granted.workflowOwnerId, owner.TESORERIA);
    assert.deepEqual(granted.workflowOwners?.map(o => o.id).sort(), [...all].sort());
    assert.equal(granted.recibeAsignacionAutomatica, true);
    await ds.updateUser({ id: userId, recibeAsignacionAutomatica: false });
    assert.equal((await grant(all)).recibeAsignacionAutomatica, false);
    await assert.rejects(grant([owner.RIESGO, owner.VENDEDORES]), /Solo se pueden combinar/);
    assert.equal(await db.userWorkflowOwner.count({ where: { userId } }), 3);

    const firstReviewDate = new Date("2025-01-02T12:00:00Z");
    const firstRiskDate = new Date("2025-02-03T12:00:00Z");
    const membership = (workflowOwnerId: string) => ({ userId_workflowOwnerId: { userId, workflowOwnerId } });
    await db.userWorkflowOwner.update({
      where: membership(owner.LEGAJOS_DIGITALES), data: { assignedAt: firstReviewDate },
    });
    await db.userWorkflowOwner.update({
      where: membership(owner.RIESGO), data: { assignedAt: firstRiskDate },
    });
    const wouldNotify = (completedAt: Date) => db.user.count({
      where: { id: userId, ...activeWorkflowAreaWhere("LEGAJOS_DIGITALES", completedAt) },
    });
    assert.equal(await wouldNotify(new Date(firstReviewDate.getTime() - 1)), 0);
    assert.equal(await wouldNotify(firstReviewDate), 1);
    // Replacing the original TESORERIA representative retains two old memberships.
    await grant([owner.LEGAJOS_DIGITALES, owner.RIESGO]);
    assert.deepEqual((await db.userWorkflowOwner.findUniqueOrThrow({
      where: membership(owner.LEGAJOS_DIGITALES),
    })).assignedAt, firstReviewDate);
    assert.deepEqual((await db.userWorkflowOwner.findUniqueOrThrow({
      where: membership(owner.RIESGO),
    })).assignedAt, firstRiskDate);
    await grant(all);
    assert.equal(await wouldNotify(firstReviewDate), 1);

    const request = await db.solicitud.create({ data: {
      createdBy: userId, assignedToUserId: userId, estadoActualId: riskState.id,
      lineaPrestamoDescripcion: "Test", lineaPrestamoLegacyOid: "test",
    } });
    const revoked = await grant([owner.TESORERIA, owner.LEGAJOS_DIGITALES]);
    assert.deepEqual(revoked.pendingAssignments?.map(p => p.id), [request.id]);
    assert.equal(revoked.pendingAssignments?.[0].areaCode, "RIESGO");
    assert.equal((await db.solicitud.findUniqueOrThrow({ where: { id: request.id } })).assignedToUserId, userId);
    assert.equal(await db.user.count({ where: { id: userId, ...activeWorkflowAreaWhere("RIESGO") } }), 0);
    assert.equal((await ds.findActiveById(userId))?.workflowOwners?.length, 2);

    const pendingCaseIds = async () => (await ds.listUsers()).find(user => user.id === userId)!
      .pendingAssignments.map(item => item.id);
    assert.deepEqual(await pendingCaseIds(), [request.id]);
    for (const workflowOwnerId of [owner.TESORERIA, null, owner.VENDEDORES]) {
      await assert.rejects(ds.assignWorkflowOwner({ userId, workflowOwnerId }), { statusCode: 409 });
    }
    for (const workflowOwnerId of [null, owner.VENDEDORES]) {
      await assert.rejects(db.user.update({ where: { id: userId }, data: { workflowOwnerId } }), /varias áreas/);
    }
    assert.equal((await ds.findById(userId))?.workflowOwners?.length, 2);
    const unrelated = await db.solicitud.create({ data: {
      createdBy: userId, assignedToUserId: userId, estadoActualId: riskState.id,
      lineaPrestamoDescripcion: "Cross-area assignment", lineaPrestamoLegacyOid: "test",
    } });
    assert.deepEqual(await pendingCaseIds(), [request.id]);
    await grant(all);
    assert.deepEqual(await pendingCaseIds(), []);
    await grant([owner.TESORERIA, owner.LEGAJOS_DIGITALES]);
    assert.deepEqual(new Set(await pendingCaseIds()), new Set([request.id, unrelated.id]));
    await db.solicitud.update({ where: { id: request.id }, data: { assignedToUserId: null } });
    await db.solicitud.update({ where: { id: unrelated.id }, data: { archivedAt: new Date() } });
    assert.deepEqual(await pendingCaseIds(), []);
    assert.equal(await wouldNotify(firstReviewDate), 1);
    await grant([owner.TESORERIA]);
    await grant([owner.LEGAJOS_DIGITALES]);
    assert.equal(await wouldNotify(firstReviewDate), 0);
    await ds.assignWorkflowOwner({ userId, workflowOwnerId: owner.RIESGO });
    const pending = await grant([]);
    assert.equal(pending.state, 2);
    assert.equal(pending.recibeAsignacionAutomatica, false);
    assert.deepEqual(pending.workflowOwners, []);
    assert.equal(pending.workflowOwnerId, null);
    assert.equal(await db.userWorkflowOwner.count({ where: { userId } }), 0);

    await Promise.all([
      grant([owner.RIESGO, owner.LEGAJOS_DIGITALES]),
      grant([owner.TESORERIA, owner.LEGAJOS_DIGITALES]),
    ]);
    const concurrent = await ds.findById(userId);
    const codes = concurrent?.workflowOwners?.map(o => o.code) ?? [];
    assert.equal(codes.length, 2);
    assert.ok(codes.includes("LEGAJOS_DIGITALES"));
    assert.equal(codes.includes("RIESGO"), concurrent?.recibeAsignacionAutomatica);

    await db.user.update({ where: { id: userId }, data: { state: 0 } });
    assert.equal((await grant([owner.RIESGO])).state, 0);
  } finally {
    await db.solicitud.deleteMany({ where: { createdBy: userId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
