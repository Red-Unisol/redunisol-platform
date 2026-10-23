import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

import { UpdateSolicitudUseCase } from "../../application/use-cases/UpdateSolicitud.use-case";
import type { UpdateSolicitudInput } from "../../application/dtos/UpdateSolicitud.dto";
import type { DbClient } from "../../../../db/prisma";
import { MontoSuperaAprobadoRiesgoError, SolicitudEditStateConflictError } from "../../domain/solicitudes-core-errors";
import { SolicitudesCoreRepositoryImpl } from "../repositories/SolicitudesCoreRepositoryImpl";
import { SolicitudesCorePrismaDatasource } from "./SolicitudesCorePrismaDatasource";

const databaseUrl = process.env.SOLICITUDES_TEST_DATABASE_URL ?? process.env.BEEX_TEST_DATABASE_URL;

describe("guardado atomico del monto aprobado por Riesgo", { skip: !databaseUrl, timeout: 15000 }, () => {
  let prisma: PrismaClient;
  let datasource: SolicitudesCorePrismaDatasource;
  let vendedor: { id: string; workflowOwnerId: string | null };
  let riesgo: { id: string; workflowOwnerId: string | null };
  let preAprobadaId: string;
  let revisionRiesgoId: string;
  const solicitudIds: string[] = [];

  before(async () => {
    assert.match(new URL(databaseUrl!).pathname, /(^|[_/-])test([_/-]|$)/i,
      "La prueba requiere una base aislada cuyo nombre contenga test.");
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    datasource = new SolicitudesCorePrismaDatasource(prisma as DbClient);
    const preAprobada = await prisma.workflowState.findUniqueOrThrow({ where: { code: "PreAprobada" } });
    const revisionRiesgo = await prisma.workflowState.findUniqueOrThrow({ where: { code: "RevisionRiesgo" } });
    preAprobadaId = preAprobada.id;
    revisionRiesgoId = revisionRiesgo.id;
    const prefix = randomUUID();
    vendedor = await prisma.user.create({ data: { email: `${prefix}-v@example.test`, legacyUser: `${prefix}-v`, passwordHash: "test-only", workflowOwnerId: preAprobada.ownerId } });
    riesgo = await prisma.user.create({ data: { email: `${prefix}-r@example.test`, legacyUser: `${prefix}-r`, passwordHash: "test-only", workflowOwnerId: revisionRiesgo.ownerId } });
  });

  after(async () => {
    if (!prisma) return;
    try {
      await prisma.solicitud.deleteMany({ where: { id: { in: solicitudIds } } });
      await prisma.user.deleteMany({ where: { id: { in: [vendedor?.id, riesgo?.id].filter((id): id is string => Boolean(id)) } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  async function fixture() {
    const row = await prisma.solicitud.create({ data: {
      createdBy: vendedor.id, estadoActualId: preAprobadaId,
      lineaPrestamoLegacyOid: "test-linea", lineaPrestamoDescripcion: "Test",
      montoAFinanciar: 500000, montoAprobadoRiesgo: 500000, cuotas: 12,
      observaciones: "original",
    } });
    solicitudIds.push(row.id);
    return row.id;
  }

  function buildUseCase(simular: () => Promise<null> = async () => null) {
    return new UpdateSolicitudUseCase({
      repository: new SolicitudesCoreRepositoryImpl(datasource),
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({
        legacyOid: "test-linea", descripcion: "Test", vigente: true,
        montoMaximo: 10000000, cantidadMaximaCuotas: 48,
      }) },
      fieldAccessRulesRepository: {
        findByWorkflowStateId: async (workflowStateId) => ({
          workflowStateId, active: true, defaultMode: "readonly",
          editableFields: ["solicitud.montoAFinanciar", "solicitud.observaciones"],
          editableGroups: [], backgroundColor: null, textColor: null,
          canManageAttachments: false, readonlyReason: null,
        }),
        findByWorkflowStateIds: async () => [],
      },
      simularCuotaSolicitud: { execute: simular },
    });
  }

  function input(id: string, user: typeof vendedor, montoAFinanciar: number): UpdateSolicitudInput {
    return { id, currentUser: user, createdBy: user.id, createdByLegacyUser: "test",
      solicitud: { montoAFinanciar, observaciones: "editado" } };
  }

  it("Riesgo guarda mientras la simulacion espera; el vendedor no pisa el nuevo tope ni otros campos", async () => {
    const id = await fixture();
    const simulationStarted = deferred();
    const releaseSimulation = deferred();
    const seller = buildUseCase(async () => { simulationStarted.resolve(); await releaseSimulation.promise; return null; });
    const rejected = assert.rejects(seller.execute(input(id, vendedor, 400000)), MontoSuperaAprobadoRiesgoError);
    await simulationStarted.promise;
    try {
      await buildUseCase().execute({ ...input(id, riesgo, 300000), solicitud: { montoAFinanciar: 300000 } });
    } finally {
      releaseSimulation.resolve();
    }
    await rejected;
    const row = await prisma.solicitud.findUniqueOrThrow({ where: { id } });
    assert.equal(Number(row.montoAFinanciar), 300000);
    assert.equal(Number(row.montoAprobadoRiesgo), 300000);
    assert.equal(row.observaciones, "original");
  });

  it("relee el tope despues de esperar el bloqueo de otro escritor", async () => {
    const id = await fixture();
    const locked = deferred();
    const releaseWriter = deferred();
    const writer = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
      locked.resolve();
      await releaseWriter.promise;
      await tx.solicitud.update({ where: { id }, data: { montoAFinanciar: 300000, montoAprobadoRiesgo: 300000 } });
    });
    await locked.promise;
    const rejected = assert.rejects(datasource.update(id, { solicitud: { montoAFinanciar: 400000 } }, {
      expectedEstadoActualId: preAprobadaId, enforceMontoAprobadoRiesgo: true,
    }), MontoSuperaAprobadoRiesgoError);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE 'SELECT id FROM solicitudes WHERE id =%'
        `;
        if (Number(rows[0].count) > 0) { waiting = true; break; }
        await setTimeout(10);
      }
      assert.ok(waiting, "El guardado debe esperar el bloqueo de la misma fila.");
    } finally {
      releaseWriter.resolve();
      await writer;
      await rejected;
    }
    const row = await prisma.solicitud.findUniqueOrThrow({ where: { id } });
    assert.equal(Number(row.montoAFinanciar), 300000);
  });

  it("rechaza un cambio de estado ocurrido durante la simulacion", async () => {
    const id = await fixture();
    const simulationStarted = deferred();
    const releaseSimulation = deferred();
    const seller = buildUseCase(async () => { simulationStarted.resolve(); await releaseSimulation.promise; return null; });
    const rejected = assert.rejects(seller.execute(input(id, vendedor, 400000)), SolicitudEditStateConflictError);
    await simulationStarted.promise;
    try {
      await prisma.solicitud.update({ where: { id }, data: { estadoActualId: revisionRiesgoId } });
    } finally {
      releaseSimulation.resolve();
    }
    await rejected;
    const row = await prisma.solicitud.findUniqueOrThrow({ where: { id } });
    assert.equal(Number(row.montoAFinanciar), 500000);
    assert.equal(row.observaciones, "original");
  });

  it("permite bajar y volver a subir hasta el aprobado y conserva la excepcion de Riesgo", async () => {
    const id = await fixture();
    const useCase = buildUseCase();
    await useCase.execute(input(id, vendedor, 200000));
    await useCase.execute(input(id, vendedor, 500000));
    const row = await useCase.execute(input(id, riesgo, 600000));
    assert.equal(row.montoAFinanciar, 600000);
    assert.equal(row.montoAprobadoRiesgo, 600000);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
