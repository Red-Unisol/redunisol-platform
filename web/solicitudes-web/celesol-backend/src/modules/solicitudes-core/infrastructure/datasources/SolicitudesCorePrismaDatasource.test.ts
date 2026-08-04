import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HISTORICAS_NEGATIVE_STATE_CODES,
  SolicitudesCorePrismaDatasource,
} from "./SolicitudesCorePrismaDatasource";
import type { CreateSolicitudCoreRecord } from "../../domain/repositories/SolicitudesCoreRepository";

describe("SolicitudesCorePrismaDatasource", () => {
  it("creates the creator participant in the same transaction as the solicitud", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const created = await datasource.create(createSolicitudRecord());

    assert.equal(created.id, "sol-1");
    assert.equal(prisma.transactionCount, 1);
    assert.equal(prisma.solicitudCreateCalls.length, 1);
    assert.deepEqual(prisma.participantUpsertCalls[0], {
      create: {
        createdBy: "user-1",
        role: "CREATOR",
        solicitudId: "sol-1",
        source: "CREATE",
        userId: "user-1",
      },
      update: {},
      where: {
        solicitudId_userId: {
          solicitudId: "sol-1",
          userId: "user-1",
        },
      },
    });
  });

  it("lists tracking solicitudes by creator or participant and applies excludeEstado", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const result = await datasource.listTracking({
      createdFrom: "2026-05-01",
      createdTo: "2026-05-31",
      excludeEstado: "CargaVendedor",
      limit: 20,
      nroDocumento: "33344455",
      offset: 40,
      userId: "user-1",
    });

    assert.deepEqual(prisma.solicitudFindManyCalls[0]?.where, {
      OR: [
        {
          createdBy: "user-1",
        },
        {
          participants: {
            some: {
              userId: "user-1",
            },
          },
        },
      ],
      archivedAt: null,
      estadoActual: {
        code: {
          not: "CargaVendedor",
        },
      },
      createdAt: {
        gte: new Date("2026-05-01T03:00:00.000Z"),
        lte: new Date("2026-06-01T02:59:59.999Z"),
      },
      titular: {
        nroDocumento: "33344455",
      },
    });
    assert.equal(prisma.solicitudFindManyCalls[0]?.skip, 40);
    assert.equal(prisma.solicitudFindManyCalls[0]?.take, 20);
    assert.deepEqual(prisma.historyFindManyCalls[0]?.where, {
      comentario: {
        not: null,
      },
      solicitudId: {
        in: ["sol-1"],
      },
    });
    assert.equal(result[0]?.ultimaNovedad, "Ultimo comentario");
  });

  it("keeps work listing scoped to the current workflow owner and exact estado", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    await datasource.listByOwner({
      estado: "CargaVendedor",
      limit: 20,
      offset: 0,
      workflowOwnerId: "owner-1",
    });
    const workWhere = prisma.solicitudFindManyCalls[0]?.where as
      | {
          estadoActual?: {
            ownerId?: string;
            code?: unknown;
          };
        }
      | undefined;

    assert.equal(
      workWhere?.estadoActual?.ownerId,
      "owner-1",
    );
    assert.equal(workWhere?.estadoActual?.code, "CargaVendedor");
    assert.equal("OR" in (workWhere ?? {}), false);
    assert.equal("createdBy" in (workWhere ?? {}), false);
    assert.equal("participants" in (workWhere ?? {}), false);
  });

  it("keeps previous behavior when excludeEstado is not provided", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    await datasource.listTracking({
      createdFrom: "2026-05-01",
      createdTo: "2026-05-31",
      limit: 20,
      nroDocumento: "33344455",
      offset: 40,
      userId: "user-1",
    });

    assert.equal(prisma.solicitudFindManyCalls[0]?.where.estadoActual, undefined);
  });

  it("converts Argentina calendar day to UTC boundaries for owner listings", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    await datasource.listByOwner({
      createdFrom: "2026-05-19",
      createdTo: "2026-05-19",
      limit: 20,
      offset: 0,
      workflowOwnerId: "owner-1",
    });

    assert.deepEqual(prisma.solicitudFindManyCalls[0]?.where.createdAt, {
      gte: new Date("2026-05-19T03:00:00.000Z"),
      lte: new Date("2026-05-20T02:59:59.999Z"),
    });
  });

  it("does not apply workflow owner filter in tracking scope", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    await datasource.listTracking({
      limit: 20,
      offset: 0,
      userId: "user-1",
    });

    const trackingWhere = prisma.solicitudFindManyCalls[0]?.where as
      | {
          OR?: unknown;
          estadoActual?: {
            ownerId?: string;
          };
        }
      | undefined;

    assert.ok(Array.isArray(trackingWhere?.OR));
    assert.equal(trackingWhere?.estadoActual?.ownerId, undefined);
  });

  it("lists recientes without creator/participant filter and applies excludeEstado", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    await datasource.listRecientes({
      createdFrom: "2026-05-01",
      createdTo: "2026-05-31",
      excludeEstado: "CargaVendedor",
      limit: 20,
      nroDocumento: "33344455",
      offset: 40,
    });

    const recientesWhere = prisma.solicitudFindManyCalls[0]?.where as
      | {
          OR?: unknown;
          createdBy?: unknown;
          participants?: unknown;
          estadoActual?: {
            ownerId?: string;
            code?: unknown;
          };
        }
      | undefined;

    assert.equal("OR" in (recientesWhere ?? {}), false);
    assert.equal("createdBy" in (recientesWhere ?? {}), false);
    assert.equal("participants" in (recientesWhere ?? {}), false);
    assert.equal(recientesWhere?.estadoActual?.ownerId, undefined);
    assert.deepEqual(recientesWhere?.estadoActual?.code, {
      notIn: [...HISTORICAS_NEGATIVE_STATE_CODES, "CargaVendedor"],
    });
  });

  it("assigns solicitud only when assignedToUserId is null", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const updated = await datasource.assignToUserIfUnassigned({
      actorUserId: "user-1",
      assignedToUserId: "user-2",
      solicitudId: "sol-1",
    });

    assert.deepEqual(prisma.solicitudUpdateManyCalls[0], {
      data: {
        assignedToUserId: "user-2",
        ejecutivoSolicitud: "Operator Two",
      },
      where: {
        assignedToUserId: null,
        id: "sol-1",
      },
    });
    assert.equal(updated?.assignedToUserId, "user-2");
    assert.equal(updated?.createdBy, "user-1");
    assert.equal(updated?.estadoActual.code, "CargaVendedor");
    assert.equal(prisma.historyCreateCalls.length, 1);
    assert.deepEqual(prisma.historyCreateCalls[0], {
      data: {
        actionCode: "ASSIGNMENT_SET",
        actionLabel: "Asignación registrada",
        changedBy: "user-1",
        comentario: null,
        estadoAnteriorId: "state-1",
        estadoNuevoId: "state-1",
        fromOwnerCodeSnapshot: "VENDEDORES",
        fromOwnerIdSnapshot: "owner-1",
        fromOwnerNameSnapshot: "Vendedores",
        fromStateCodeSnapshot: "CargaVendedor",
        fromStateNameSnapshot: "Carga vendedor",
        metadata: {
          assignedToUserId: "user-2",
          event: "ASSIGNMENT_SET",
        },
        motivo: "ASSIGNMENT_SET",
        requiresComment: false,
        saveAndExit: false,
        solicitudId: "sol-1",
        toOwnerCodeSnapshot: "VENDEDORES",
        toOwnerIdSnapshot: "owner-1",
        toOwnerNameSnapshot: "Vendedores",
        toStateCodeSnapshot: "CargaVendedor",
        toStateNameSnapshot: "Carga vendedor",
        transitionId: null,
      },
    });
  });

  it("reassigns an already-assigned solicitud when allowReassignment is true", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const updated = await datasource.assignToUserIfUnassigned({
      actorUserId: "user-1",
      allowReassignment: true,
      assignedToUserId: "user-2",
      solicitudId: "sol-1",
    });

    assert.deepEqual(prisma.solicitudUpdateManyCalls[0], {
      data: {
        assignedToUserId: "user-2",
        ejecutivoSolicitud: "Operator Two",
      },
      where: {
        id: "sol-1",
      },
    });
    assert.equal(updated?.assignedToUserId, "user-2");
  });

  it("returns null when assignment update affects zero rows", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    prisma.updateManyCount = 0;
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const updated = await datasource.assignToUserIfUnassigned({
      actorUserId: "user-1",
      assignedToUserId: "user-2",
      solicitudId: "sol-1",
    });

    assert.equal(updated, null);
    assert.equal(prisma.historyCreateCalls.length, 0);
  });

  it("finds target user by id with workflowOwnerId only", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const user = await datasource.findUserById("user-2");

    assert.deepEqual(prisma.userFindUniqueCalls[0], {
      select: {
        id: true,
        workflowOwnerId: true,
      },
      where: {
        id: "user-2",
      },
    });
    assert.deepEqual(user, {
      id: "user-2",
      workflowOwnerId: "owner-2",
    });
  });

  it("lists active users scoped to a workflow owner id when provided", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const agents = await datasource.listUsersByWorkflowOwnerId("owner-1");

    assert.deepEqual(prisma.userFindManyCalls[0], {
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { email: "asc" }],
      select: {
        email: true,
        firstName: true,
        id: true,
        lastName: true,
      },
      where: {
        deletedAt: null,
        state: 1,
        workflowOwnerId: "owner-1",
      },
    });
    assert.deepEqual(agents, [
      { email: "agent1@example.com", fullName: "Agent One", id: "agent-1" },
    ]);
  });

  it("lists all active users when no workflow owner id is provided", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    await datasource.listUsersByWorkflowOwnerId();

    assert.deepEqual(prisma.userFindManyCalls[0], {
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { email: "asc" }],
      select: {
        email: true,
        firstName: true,
        id: true,
        lastName: true,
      },
      where: {
        deletedAt: null,
        state: 1,
      },
    });
  });

  it("finds workflow owner code by owner id", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const code = await datasource.findWorkflowOwnerCodeById("owner-2");

    assert.deepEqual(prisma.workflowOwnerFindUniqueCalls[0], {
      select: {
        code: true,
      },
      where: {
        id: "owner-2",
      },
    });
    assert.equal(code, "RIESGO");
  });

  it("lists unassigned, non-archived solicitudes for the sin-asignar dashboard section", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const result = await datasource.listSolicitudesSinAsignar({
      fechaDesde: "2026-07-01",
      fechaHasta: "2026-07-31",
    });

    assert.deepEqual(prisma.solicitudFindManyCalls[0]?.where, {
      archivedAt: null,
      assignedToUserId: null,
      AND: [
        {
          createdAt: {
            gte: new Date("2026-07-01T03:00:00.000Z"),
            lte: new Date("2026-08-01T02:59:59.999Z"),
          },
        },
        { estadoActual: { code: { not: "CargaVendedor" } } },
      ],
    });
    assert.equal(prisma.solicitudFindManyCalls[0]?.take, 8);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, "sol-1");
    assert.equal(result[0]?.titular, "Perez, Juan");
    assert.equal(result[0]?.linea, "Personal");
    assert.equal(typeof result[0]?.diasActiva, "number");
  });

  it("excludes CargaVendedor solicitudes from every admin dashboard query in getStats", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    await datasource.getStats({ fechaDesde: "2026-07-01", fechaHasta: "2026-07-31" });

    const expectedFilterWhere = {
      AND: [
        {
          createdAt: {
            gte: new Date("2026-07-01T03:00:00.000Z"),
            lte: new Date("2026-08-01T02:59:59.999Z"),
          },
        },
        { estadoActual: { code: { not: "CargaVendedor" } } },
      ],
    };

    assert.deepEqual(prisma.solicitudCountCalls[0]?.where, expectedFilterWhere);
    assert.deepEqual(prisma.solicitudGroupByCalls[0]?.where, expectedFilterWhere);
    assert.deepEqual(prisma.solicitudCountCalls[7]?.where, {
      archivedAt: null,
      ejecutivoSolicitud: null,
      estadoActual: { code: { not: "CargaVendedor" } },
    });
    const workflowStateCall = prisma.workflowStateFindManyCalls[0] as {
      where: unknown;
    };
    assert.deepEqual(workflowStateCall.where, {
      isActive: true,
      code: { not: "CargaVendedor" },
    });
  });

  it("returns real estado/area/linea catalogs as filterOptions so the dashboard filters stop being hardcoded", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    prisma.workflowStateFindManyResult = [
      { code: "RevisionRiesgo", name: "Revision Riesgo", owner: { sortOrder: 2 } },
      { code: "Confirmada", name: "Confirmada", owner: { sortOrder: 2 } },
    ];
    prisma.workflowOwnerFindManyResult = [
      { code: "VENDEDORES", name: "Vendedores" },
      { code: "HISTORIAL", name: "Historial" },
    ];
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getStats({
      fechaDesde: "2026-07-01",
      fechaHasta: "2026-07-31",
    });

    assert.deepEqual(stats.filterOptions.estados, [
      { code: "RevisionRiesgo", name: "Revision Riesgo" },
      { code: "Confirmada", name: "Confirmada" },
    ]);
    assert.deepEqual(stats.filterOptions.areas, [
      { code: "VENDEDORES", name: "Vendedores" },
      { code: "HISTORIAL", name: "Historial" },
    ]);
    assert.deepEqual(stats.filterOptions.lineas, ["Personal"]);
    assert.deepEqual(prisma.workflowOwnerFindManyCalls[0], {
      where: { isActive: true },
      select: { code: true, name: true },
      orderBy: { sortOrder: "asc" },
    });
  });

  it("scopes getVendedorStats to the given vendedorId and period", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    prisma.solicitudCountResult = 4;
    prisma.solicitudAggregateSumResult = 1_200_000;
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getVendedorStats({
      fechaDesde: "2026-07-01",
      fechaHasta: "2026-07-31",
      vendedorId: "vendedor-1",
    });

    assert.equal(stats.kpis.solicitudesIniciadas, 4);
    assert.equal(stats.kpis.montoLiquidado, 1_200_000);
    assert.equal(stats.kpis.aprobadoSinLiquidar, 1_200_000);
    const countWhere = prisma.solicitudCountCalls[0]?.where;
    assert.equal((countWhere as { vendedorId: string })?.vendedorId, "vendedor-1");
    assert.deepEqual((countWhere as { createdAt: unknown })?.createdAt, {
      gte: new Date("2026-07-01T03:00:00.000Z"),
      lte: new Date("2026-08-01T02:59:59.999Z"),
    });
  });

  it("computes montosPorLinea from groupBy results", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    prisma.solicitudGroupByResult = [
      {
        lineaPrestamoDescripcion: "AMEJUCA ESPECIAL",
        _count: { _all: 3 },
        _sum: { montoAFinanciar: 1_950_000 },
      },
    ];
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getVendedorStats({
      fechaDesde: "2026-07-01",
      fechaHasta: "2026-07-31",
      vendedorId: "vendedor-1",
    });

    assert.deepEqual(stats.montosPorLinea, [
      { linea: "AMEJUCA ESPECIAL", monto: 1_950_000, count: 3 },
    ]);
    assert.equal(prisma.solicitudGroupByCalls[0]?.by[0], "lineaPrestamoDescripcion");
  });

  it("lists pendientes for active, non-system-owned states ordered oldest first", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getVendedorStats({
      fechaDesde: "2026-07-01",
      fechaHasta: "2026-07-31",
      vendedorId: "vendedor-1",
    });

    assert.equal(stats.pendientes.length, 1);
    assert.equal(stats.pendientes[0]?.titular, "Perez, Juan");
    assert.equal(stats.pendientes[0]?.linea, "Personal");
    const pendientesCall = prisma.solicitudFindManyCalls.find(
      (call) =>
        (call.where as { estadoActual?: { isActive?: boolean } })
          ?.estadoActual?.isActive === true,
    );
    assert.ok(pendientesCall, "expected a findMany call filtered by isActive states");
  });

  it("returns null tiempoPromedioDiasLiquidacion when there is no liquidada history", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    prisma.historyFindManyResult = [];
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getVendedorStats({
      fechaDesde: "2026-07-01",
      fechaHasta: "2026-07-31",
      vendedorId: "vendedor-1",
    });

    assert.equal(stats.kpis.tiempoPromedioDiasLiquidacion, null);
  });

  it("returns filterOptions.lineas from distinct lineaPrestamoDescripcion for getVendedorStats", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getVendedorStats({
      fechaDesde: "2026-07-01",
      fechaHasta: "2026-07-31",
      vendedorId: "vendedor-1",
    });

    assert.deepEqual(stats.filterOptions.lineas, ["Personal"]);
  });

  it("counts asignadosAMi scoped to the analista and current-state filters, ignoring período", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    prisma.solicitudCountResult = 3;
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getAnalistaStats({
      analistaId: "analista-1",
      areaOwnerCode: "RIESGO",
      fechaDesde: "2026-07-01",
      fechaHasta: "2026-07-31",
      umbralDias: 7,
      vista: "mis_casos",
    });

    assert.equal(stats.kpis.asignadosAMi, 3);
    const countWhere = prisma.solicitudCountCalls[0]?.where as {
      archivedAt: null;
      AND: Array<Record<string, unknown>>;
    };
    assert.equal(countWhere.archivedAt, null);
    assert.deepEqual(
      countWhere.AND.find((c) => "assignedToUserId" in c),
      { assignedToUserId: "analista-1" },
    );
    assert.ok(
      !countWhere.AND.some((c) => "createdAt" in c),
      "asignadosAMi no debe filtrar por período",
    );
  });

  it("counts sinAsignarEnMiArea scoped to the analista's owner area", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    await datasource.getAnalistaStats({
      analistaId: "analista-1",
      areaOwnerCode: "RIESGO",
      umbralDias: 7,
      vista: "mis_casos",
    });

    const sinAsignarCall = prisma.solicitudCountCalls.find((c) => {
      const where = c.where as { AND: Array<Record<string, unknown>> };
      return where.AND.some(
        (cond) =>
          "assignedToUserId" in cond &&
          (cond as { assignedToUserId: unknown }).assignedToUserId === null,
      );
    });
    assert.ok(sinAsignarCall, "expected a count call for sin-asignar-en-mi-area");
    const where = sinAsignarCall!.where as { AND: Array<Record<string, unknown>> };
    assert.deepEqual(
      where.AND.find((c) => "assignedToUserId" in c),
      { assignedToUserId: null, estadoActual: { owner: { code: "RIESGO" } } },
    );
  });

  it("counts casosConRevision as analista's own solicitudes in Revisar", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    await datasource.getAnalistaStats({
      analistaId: "analista-1",
      areaOwnerCode: "RIESGO",
      umbralDias: 7,
      vista: "mis_casos",
    });

    const revisionCall = prisma.solicitudCountCalls.find((c) => {
      const where = c.where as {
        assignedToUserId?: string;
        estadoActual?: { code?: string };
      };
      return where.estadoActual?.code === "Revisar";
    });
    assert.ok(revisionCall, "expected a count call filtered by estado Revisar");
    assert.equal(
      (revisionCall!.where as { assignedToUserId: string }).assignedToUserId,
      "analista-1",
    );
  });

  it("builds backlogPorEstado from the RIESGO backlog state codes", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    prisma.workflowStateFindManyResult = [
      { code: "RevisionRiesgo", name: "Revisión Riesgo" },
      { code: "Confirmada", name: "Confirmada" },
      { code: "Motor", name: "Motor" },
    ];
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getAnalistaStats({
      analistaId: "analista-1",
      areaOwnerCode: "RIESGO",
      umbralDias: 7,
      vista: "mis_casos",
    });

    assert.deepEqual(
      stats.backlogPorEstado.map((b) => b.estado).sort(),
      ["Confirmada", "Motor", "Revisión Riesgo"].sort(),
    );
    const stateCall = prisma.workflowStateFindManyCalls[0] as {
      where: { code: { in: string[] } };
    };
    assert.deepEqual(
      stateCall.where.code.in.sort(),
      ["Confirmada", "Motor", "RevisionRiesgo"].sort(),
    );
  });

  it("returns filterOptions with lineas and vendedores", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getAnalistaStats({
      analistaId: "analista-1",
      areaOwnerCode: "RIESGO",
      umbralDias: 7,
      vista: "mis_casos",
    });

    assert.deepEqual(stats.filterOptions.lineas, ["Personal"]);
    assert.equal(stats.filterOptions.vendedores[0]?.id, "agent-1");
  });

  it("computes detenidosMasDeNDias using max(changedAt) with createdAt fallback", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    prisma.historyFindManyResult = [
      {
        changedAt: new Date(),
        comentario: "",
        solicitudId: "sol-1",
        solicitud: { createdAt: new Date("2026-05-12T10:00:00.000Z") },
      },
    ];
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getAnalistaStats({
      analistaId: "analista-1",
      areaOwnerCode: "RIESGO",
      umbralDias: 1,
      vista: "mis_casos",
    });

    assert.equal(typeof stats.kpis.detenidosMasDeNDias, "number");
  });

  it("computes tasaDeRechazoPeriodo as Rechazadas / (Confirmadas + Rechazadas) attributed by changedBy", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getAnalistaStats({
      analistaId: "analista-1",
      areaOwnerCode: "RIESGO",
      fechaDesde: "2026-07-01",
      fechaHasta: "2026-07-31",
      umbralDias: 7,
      vista: "mis_casos",
    });

    assert.ok(
      stats.kpis.tasaDeRechazoPeriodo === null ||
        typeof stats.kpis.tasaDeRechazoPeriodo === "number",
    );
    const attributedCall = prisma.historyFindManyCalls.find((c) => {
      const where = c.where as unknown as {
        changedBy?: string;
        toStateCodeSnapshot?: { in: string[] };
      };
      return (
        where.changedBy === "analista-1" &&
        where.toStateCodeSnapshot?.in?.includes("Rechazada")
      );
    });
    assert.ok(attributedCall, "expected a historial query attributed by changedBy");
  });

  it("returns null tasaDeRechazoPeriodo when there are no evaluated cases", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    prisma.historyFindManyResult = [];
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getAnalistaStats({
      analistaId: "analista-1",
      areaOwnerCode: "RIESGO",
      fechaDesde: "2026-07-01",
      fechaHasta: "2026-07-31",
      umbralDias: 7,
      vista: "mis_casos",
    });

    assert.equal(stats.kpis.tasaDeRechazoPeriodo, null);
  });

  it("lists casosParaTomar ordered oldest first, scoped to sin-asignar in area", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getAnalistaStats({
      analistaId: "analista-1",
      areaOwnerCode: "RIESGO",
      umbralDias: 7,
      vista: "mis_casos",
    });

    assert.equal(stats.casosParaTomar.length, 1);
    assert.equal(stats.casosParaTomar[0]?.titular, "Perez, Juan");
    assert.equal(stats.casosParaTomar[0]?.vendedor, "Elias Gallay");
  });

  it("maps transicionesLentas destination from the static estado map", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getAnalistaStats({
      analistaId: "analista-1",
      areaOwnerCode: "RIESGO",
      umbralDias: 0,
      vista: "mis_casos",
    });

    for (const item of stats.transicionesLentas) {
      assert.ok(item.estadoDestinoEsperado.length > 0);
    }
  });

  it("v2: counts the same 4 KPIs as v1 (asignadosAMi/sinAsignarEnMiArea/detenidosMasDeNDias/casosConRevision)", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    prisma.solicitudCountResult = 4;
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getAnalistaStatsV2({
      analistaId: "analista-1",
      areaOwnerCode: "RIESGO",
      umbralDias: 7,
      vista: "mis_casos",
    });

    assert.equal(stats.kpis.asignadosAMi, 4);
    assert.equal(typeof stats.kpis.sinAsignarEnMiArea, "number");
    assert.equal(typeof stats.kpis.detenidosMasDeNDias, "number");
    assert.equal(typeof stats.kpis.casosConRevision, "number");
  });

  it("v2: lists casosParaTomar scoped to sin-asignar in area, ordered oldest first", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getAnalistaStatsV2({
      analistaId: "analista-1",
      areaOwnerCode: "RIESGO",
      umbralDias: 7,
      vista: "mis_casos",
    });

    assert.equal(stats.casosParaTomar.length, 1);
    assert.equal(stats.casosParaTomar[0]?.titular, "Perez, Juan");
    assert.equal(stats.casosParaTomar[0]?.vendedor, "Elias Gallay");
  });

  it("v2: returns filterOptions with lineas and vendedores", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getAnalistaStatsV2({
      analistaId: "analista-1",
      areaOwnerCode: "RIESGO",
      umbralDias: 7,
      vista: "mis_casos",
    });

    assert.deepEqual(stats.filterOptions.lineas, ["Personal"]);
    assert.equal(stats.filterOptions.vendedores[0]?.id, "agent-1");
  });

  it("v2: builds misCasosActivos with turno based on estadoActual.owner", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getAnalistaStatsV2({
      analistaId: "analista-1",
      areaOwnerCode: "RIESGO",
      umbralDias: 7,
      vista: "mis_casos",
    });

    assert.equal(stats.misCasosActivos.length, 1);
    assert.equal(stats.misCasosActivos[0]?.titular, "Perez, Juan");
    assert.equal(stats.misCasosActivos[0]?.turno, "otro");
  });

  it("v2: sorts misCasosActivos with volvioCorregido first, then by diasAcumulados desc", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getAnalistaStatsV2({
      analistaId: "analista-1",
      areaOwnerCode: "RIESGO",
      umbralDias: 0,
      vista: "mis_casos",
    });

    for (let i = 1; i < stats.misCasosActivos.length; i += 1) {
      const prev = stats.misCasosActivos[i - 1]!;
      const curr = stats.misCasosActivos[i]!;
      if (prev.volvioCorregido === curr.volvioCorregido) {
        assert.ok(prev.diasAcumulados >= curr.diasAcumulados);
      } else {
        assert.ok(prev.volvioCorregido && !curr.volvioCorregido);
      }
    }
  });

  it("v2: caps misCasosActivos at 20 rows", async () => {
    const prisma = new FakeSolicitudesCorePrisma();
    const datasource = new SolicitudesCorePrismaDatasource(prisma.client());

    const stats = await datasource.getAnalistaStatsV2({
      analistaId: "analista-1",
      areaOwnerCode: "RIESGO",
      umbralDias: 7,
      vista: "mis_casos",
    });

    assert.ok(stats.misCasosActivos.length <= 20);
  });

});

function createSolicitudRecord(): CreateSolicitudCoreRecord {
  return {
    conyuge: null,
    createdBy: "user-1",
    cuotaResultante: null,
    cuotas: null,
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
    ejecutivoSolicitud: null,
    estadoActual: {
      code: "CargaVendedor",
      id: "state-1",
      name: "Carga vendedor",
    },
    firmaDigitalmente: false,
    garantias: [],
    lineaPrestamoDescripcion: "Personal",
    lineaPrestamoLegacyOid: "LP-1",
    montoAFinanciar: null,
    motivo: null,
    observaciones: null,
    titular: {
      apellidoDenominacion: "Perez",
      cbu: null,
      celular: null,
      cuit: null,
      domicilioCalle: null,
      email: null,
      localidad: null,
      nombre: "Juan",
      nroDocumento: "33344455",
      nroPuerta: null,
      nroSocio: null,
      tipoDocumento: "DNI",
    },
    vendedorSolicitud: "Elias Gallay",
  };
}

class FakeSolicitudesCorePrisma {
  historyCreateCalls: unknown[] = [];
  historyFindManyCalls: Array<{
    orderBy: { changedAt: string };
    select: { changedAt: boolean; comentario: boolean; solicitudId: boolean };
    where: {
      comentario: { not: null };
      solicitudId: { in: string[] };
    };
  }> = [];
  participantUpsertCalls: unknown[] = [];
  solicitudCreateCalls: unknown[] = [];
  solicitudFindUniqueCalls: Array<{ where: { id: string } }> = [];
  solicitudFindManyCalls: Array<{
    include: unknown;
    orderBy: { createdAt: string };
    skip: number;
    take: number;
    where: Record<string, unknown>;
  }> = [];
  solicitudUpdateManyCalls: Array<{
    data: { assignedToUserId: string; ejecutivoSolicitud?: string };
    where: { assignedToUserId: null; id: string };
  }> = [];
  solicitudCountCalls: Array<{ where: Record<string, unknown> }> = [];
  solicitudAggregateCalls: Array<{ where: Record<string, unknown> }> = [];
  solicitudGroupByCalls: Array<{
    by: string[];
    where: Record<string, unknown>;
  }> = [];
  workflowStateFindManyCalls: unknown[] = [];
  solicitudCountResult = 0;
  solicitudAggregateSumResult: number | null = 0;
  solicitudGroupByResult: Array<{
    lineaPrestamoDescripcion: string;
    _count: { _all: number };
    _sum?: { montoAFinanciar: number };
  }> = [];
  workflowStateFindManyResult: Array<{
    code: string;
    name: string;
    owner?: { sortOrder: number };
  }> = [];
  historyFindManyResult: Array<{
    changedAt: Date;
    comentario: string;
    solicitudId: string;
    solicitud: { createdAt: Date };
  }> = [
    {
      changedAt: new Date("2026-05-19T10:00:00.000Z"),
      comentario: "  Ultimo comentario  ",
      solicitudId: "sol-1",
      solicitud: { createdAt: new Date("2026-05-12T10:00:00.000Z") },
    },
  ];
  transactionCount = 0;
  updateManyCount = 1;
  workflowOwnerFindUniqueCalls: Array<{
    select: { code: boolean };
    where: { id: string };
  }> = [];
  workflowOwnerFindManyCalls: unknown[] = [];
  workflowOwnerFindManyResult: Array<{ code: string; name: string }> = [
    { code: "VENDEDORES", name: "Vendedores" },
    { code: "RIESGO", name: "Riesgo" },
  ];
  userFindUniqueCalls: Array<{
    select: Record<string, boolean>;
    where: { id: string };
  }> = [];
  userFindManyCalls: Array<{
    orderBy: unknown;
    select: Record<string, boolean>;
    where: Record<string, unknown>;
  }> = [];

  client() {
    const tx = {
      solicitud: {
        create: async (input: unknown) => {
          this.solicitudCreateCalls.push(input);
          return solicitudPrismaRecord();
        },
        findUnique: async (input: { where: { id: string } }) => {
          this.solicitudFindUniqueCalls.push(input);
          return solicitudPrismaRecord({
            assignedToUserId: "user-2",
          });
        },
        findMany: async (input: {
          include: unknown;
          orderBy: { createdAt: string };
          skip: number;
          take: number;
          where: Record<string, unknown>;
        }) => {
          this.solicitudFindManyCalls.push(input);
          return [solicitudPrismaRecord()];
        },
        updateMany: async (input: {
          data: { assignedToUserId: string };
          where: { assignedToUserId: null; id: string };
        }) => {
          this.solicitudUpdateManyCalls.push(input);
          return { count: this.updateManyCount };
        },
        count: async (input: { where: Record<string, unknown> }) => {
          this.solicitudCountCalls.push(input);
          return this.solicitudCountResult;
        },
        aggregate: async (input: { where: Record<string, unknown> }) => {
          this.solicitudAggregateCalls.push(input);
          return { _sum: { montoAFinanciar: this.solicitudAggregateSumResult } };
        },
        groupBy: async (input: { by: string[]; where: Record<string, unknown> }) => {
          this.solicitudGroupByCalls.push(input);
          return this.solicitudGroupByResult;
        },
      },
      user: {
        findUnique: async (input: {
          select: Record<string, boolean>;
          where: { id: string };
        }) => {
          this.userFindUniqueCalls.push(input);
          const userRecord = {
            id: input.where.id,
            firstName: "Operator",
            lastName: "Two",
            legacyUser: "OPERATOR2",
            workflowOwnerId: "owner-2",
          };

          if (input.select.id || input.select.workflowOwnerId) {
            return {
              id: userRecord.id,
              workflowOwnerId: userRecord.workflowOwnerId,
            };
          }

          return {
            firstName: userRecord.firstName,
            lastName: userRecord.lastName,
            legacyUser: userRecord.legacyUser,
          };
        },
        findMany: async (input: {
          orderBy: unknown;
          select: Record<string, boolean>;
          where: Record<string, unknown>;
        }) => {
          this.userFindManyCalls.push(input);
          return [
            {
              email: "agent1@example.com",
              firstName: "Agent",
              id: "agent-1",
              lastName: "One",
            },
          ];
        },
      },
      solicitudParticipant: {
        upsert: async (input: unknown) => {
          this.participantUpsertCalls.push(input);
          return {};
        },
      },
      solicitudEstadoHistorial: {
        create: async (input: unknown) => {
          this.historyCreateCalls.push(input);
          return input;
        },
        findMany: async (input: {
          orderBy: { changedAt: string };
          select: { changedAt: boolean; comentario: boolean; solicitudId: boolean };
          where: {
            comentario: { not: null };
            solicitudId: { in: string[] };
          };
        }) => {
          this.historyFindManyCalls.push(input);
          return this.historyFindManyResult;
        },
      },
    };

    return {
      solicitud: tx.solicitud,
      solicitudEstadoHistorial: tx.solicitudEstadoHistorial,
      user: tx.user,
      workflowState: {
        findMany: async (input: unknown) => {
          this.workflowStateFindManyCalls.push(input);
          return this.workflowStateFindManyResult;
        },
      },
      workflowOwner: {
        findUnique: async (input: {
          select: { code: boolean };
          where: { id: string };
        }) => {
          this.workflowOwnerFindUniqueCalls.push(input);
          return { code: "RIESGO" };
        },
        findMany: async (input: unknown) => {
          this.workflowOwnerFindManyCalls.push(input);
          return this.workflowOwnerFindManyResult;
        },
      },
      $transaction: async <T>(callback: (executor: typeof tx) => Promise<T>) => {
        this.transactionCount += 1;
        return callback(tx);
      },
    } as never;
  }
}

function solicitudPrismaRecord(overrides: Record<string, unknown> = {}) {
  return {
    archivedAt: null,
    assignedToUserId: null,
    conyuge: null,
    createdAt: new Date("2026-05-12T10:00:00.000Z"),
    createdBy: "user-1",
    cuotaResultante: null,
    cuotas: null,
    cupoTitular: null,
    datosLaborales: null,
    ejecutivoSolicitud: null,
    estadoActual: {
      code: "CargaVendedor",
      createdAt: new Date("2026-05-12T10:00:00.000Z"),
      description: null,
      id: "state-1",
      isActive: true,
      isInitial: true,
      isTerminal: false,
      name: "Carga vendedor",
      owner: {
        code: "VENDEDORES",
        id: "owner-1",
        isActive: true,
        name: "Vendedores",
        sortOrder: 0,
      },
      ownerId: "owner-1",
      updatedAt: new Date("2026-05-12T10:00:00.000Z"),
    },
    estadoActualId: "state-1",
    fechaPrimerVencimiento: null,
    firmaDigitalmente: false,
    garantias: [],
    id: "sol-1",
    legacyOid: null,
    lineaPrestamoDescripcion: "Personal",
    lineaPrestamoLegacyOid: "LP-1",
    montoAFinanciar: null,
    motivo: null,
    nroOperacion: null,
    nroSolicitud: null,
    observaciones: null,
    titular: {
      apellidoDenominacion: "Perez",
      cbu: null,
      celular: null,
      cuit: null,
      domicilioCalle: null,
      email: null,
      estadoCivil: null,
      localidad: null,
      nacionalidad: null,
      nombre: "Juan",
      nroDocumento: "33344455",
      nroPuerta: null,
      nroSocio: null,
      personaExpuestaPoliticamente: null,
      sexo: null,
      solicitudId: "sol-1",
      telefonoFijo: null,
      tipoDocumento: "DNI",
    },
    updatedAt: new Date("2026-05-12T10:00:00.000Z"),
    vendedorSolicitud: "Elias Gallay",
    ...overrides,
  };
}
