import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, it } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import express, { type ErrorRequestHandler } from "express";
import { SociosPrismaDatasource } from "../../../socios/infrastructure/datasources/SociosPrismaDatasource";
import { SocioRepositoryImpl } from "../../../socios/infrastructure/repositories/SocioRepositoryImpl";
import { SolicitudAdjuntosPrismaDatasource } from "../../adjuntos/infrastructure/datasources/SolicitudAdjuntosPrismaDatasource";
import { SolicitudAdjuntoRepositoryImpl } from "../../adjuntos/infrastructure/repositories/SolicitudAdjuntoRepositoryImpl";
import { ChangeSolicitudStateUseCase } from "../../application/use-cases/ChangeSolicitudState.use-case";
import { UpdateSolicitudUseCase } from "../../application/use-cases/UpdateSolicitud.use-case";
import { AdministrativeCorrectionError, coreConditionsFingerprint } from "../../domain/workflow/AdministrativeCorrection";
import { SolicitudWorkflowEngine } from "../../domain/workflow/SolicitudWorkflowEngine";
import { SolicitudesCoreController } from "../../presentation/SolicitudesCoreController";
import { SolicitudFieldAccessRulesPrismaDatasource } from "../datasources/SolicitudFieldAccessRulesPrismaDatasource";
import { SolicitudesCorePrismaDatasource } from "../datasources/SolicitudesCorePrismaDatasource";
import { SolicitudWorkflowPrismaDatasource } from "../datasources/SolicitudWorkflowPrismaDatasource";
import { SolicitudFieldAccessRulesRepositoryImpl } from "../repositories/SolicitudFieldAccessRulesRepositoryImpl";
import { CompleteSellerReview } from "./CompleteSellerReview";

const databaseUrl = process.env.BEEX_TEST_DATABASE_URL;
const db = new PrismaClient({ datasourceUrl: databaseUrl });
after(() => db.$disconnect());

it("POST de revisión guarda y cambia de estado una sola vez o revierte todo", { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  assert(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.endsWith("_test"));
  const [liquidada, riesgo] = await Promise.all(["Liquidada", "RevisionRiesgo"].map(code =>
    db.workflowState.findUniqueOrThrow({ where: { code } }),
  ));
  const makeUser = (workflowOwnerId: string) => db.user.create({ data: {
    email: `${randomUUID()}@example.test`, legacyUser: randomUUID(), passwordHash: "test", workflowOwnerId,
  } });
  const [seller, analyst] = await Promise.all([makeUser(liquidada.ownerId), makeUser(riesgo.ownerId)]);
  const dni = String(randomInt(10_000_000, 99_999_999));
  const socio = await db.socio.create({ data: {
    cuit: "20" + dni + "1", tipoPersona: "FISICA", tipoDocumento: "DNI", nroDocumento: dni,
    nombre: "Prueba", apellido: "Vendedor", sexo: "M", fechaDeNacimiento: new Date("1980-01-01"),
  } });
  const makeReview = async (missingControl?: typeof Prisma.DbNull | typeof Prisma.JsonNull) => {
    const row = await db.solicitud.create({ data: {
      createdBy: seller.id, assignedToUserId: analyst.id, estadoActualId: liquidada.id, sellerReviewStartedAt: new Date(),
      legacyOid: randomUUID(), lineaPrestamoLegacyOid: "1", lineaPrestamoDescripcion: "Prueba",
      montoAFinanciar: 10000, cuotas: 10, administrativeCoreControl: missingControl,
      titular: { create: { tipoDocumento: "DNI", nroDocumento: dni, celular: "1111" } },
    }, include: { titular: true } });
    if (missingControl) return row;
    return db.solicitud.update({ where: { id: row.id }, data: { administrativeCoreControl: {
      loanId: row.legacyOid, reconciledFingerprint: coreConditionsFingerprint(row),
    } } });
  };
  const read = (id: string) => db.solicitud.findUniqueOrThrow({ where: { id }, include: { estadoActual: true, titular: true } });
  const persistedEvents = (id: string) => db.solicitudEstadoHistorial.count({ where: { solicitudId: id } });
  const repository = new SolicitudesCorePrismaDatasource(db);
  const updates = new UpdateSolicitudUseCase({
    repository, fieldAccessRulesRepository: new SolicitudFieldAccessRulesRepositoryImpl(new SolicitudFieldAccessRulesPrismaDatasource(db)),
    lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ legacyOid: "1", descripcion: "Prueba", vigente: true, cantidadMaximaCuotas: 60, montoMaximo: 100000 }) },
    simularCuotaSolicitud: { execute: async () => null },
  });
  const socios = new SocioRepositoryImpl(new SociosPrismaDatasource(db));
  let rejectLoan = false;
  let financialChecks = 0;
  const review = new CompleteSellerReview(db, updates, socios, async () => {
    financialChecks++;
    if (rejectLoan) throw new AdministrativeCorrectionError("Préstamo pendiente de conciliación.");
  });
  const workflow = new SolicitudWorkflowPrismaDatasource(db);
  const changeSolicitudStateUseCase = new ChangeSolicitudStateUseCase({
    now: () => new Date(), solicitudesRepository: repository, sociosRepository: socios,
    adjuntoRepository: new SolicitudAdjuntoRepositoryImpl(new SolicitudAdjuntosPrismaDatasource(db)),
    engine: new SolicitudWorkflowEngine({ repository: workflow }),
    completeSellerReview: (input, command) => review.execute(input, command),
  });
  let currentUser = seller;
  // Se monta únicamente el handler productivo de transiciones. La sesión de
  // prueba y la consulta a Vimarx son los dos límites externos de este test.
  const controller = new SolicitudesCoreController({
    changeSolicitudStateUseCase, getCurrentUserUseCase: { execute: async () => currentUser },
  } as unknown as ConstructorParameters<typeof SolicitudesCoreController>[0]);
  const app = express();
  app.use(express.json());
  app.post("/solicitudes/:id/transitions", controller.changeState);
  const errors: ErrorRequestHandler = (err, _req, res, _next) => { res.status(err.statusCode ?? err.status ?? 500).json({ error: err.name, message: err.message }); };
  app.use(errors);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const post = (row: { id: string; updatedAt: Date }, body: object = {}) =>
    fetch(`http://127.0.0.1:${port}/solicitudes/${row.id}/transitions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionCode: "finalizar_revision_datos", expectedUpdatedAt: row.updatedAt.toISOString(), ...body }),
    });

  try {
    await t.test("una corrección devuelve a Revisión de Riesgo, incluso frente a doble clic", async () => {
      const row = await makeReview(Prisma.JsonNull);
      const body = { changes: { titular: { celular: "2222" } } };
      const responses = await Promise.all([post(row, body), post(row, body)]);
      assert.deepEqual(responses.map(r => r.status).sort(), [200, 409], await Promise.all(responses.filter(r => !r.ok).map(r => r.text())).then(bodies => bodies.join(" | ")));
      const saved = await read(row.id);
      assert.equal(saved.estadoActual.code, "RevisionRiesgo");
      assert.equal(saved.titular?.celular, "2222");
      assert.equal(saved.analisisFinalizadoAt, null);
      assert.deepEqual(saved.sellerReviewChanges, [{ field: "titular.celular", before: "1111", after: "2222" }]);
      assert.equal(await persistedEvents(row.id), 1);
      assert.equal(financialChecks, 0);
    });
    await t.test("confirmar sin diferencias entrega la ficha a Legajos y registra el cierre", async () => {
      const row = await makeReview();
      assert.equal((await post(row, { changes: { titular: { celular: "1111" } } })).status, 200);
      const saved = await read(row.id);
      assert.equal(saved.estadoActual.code, "VerificarFirmaYDocumentacion");
      assert.equal(saved.analisisFinalizadoBy, seller.id);
      assert(saved.analisisFinalizadoAt);
      assert.equal(saved.sellerReviewStartedAt, null);
      assert.equal(await persistedEvents(row.id), 1);
      assert.equal(financialChecks, 1);
    });
    await t.test("sin registro, ni Liquidada ni los tres avances de Confirmada modifican el préstamo o el análisis", async () => {
      const confirmed = await db.workflowState.findUniqueOrThrow({ where: { code: "Confirmada" } });
      const beforeChecks = financialChecks;
      for (const missingControl of [Prisma.DbNull, Prisma.JsonNull]) {
        const row = await makeReview(missingControl);
        const sellerActions = await workflow.listAvailableTransitions({ solicitudId: row.id, workflowOwnerId: liquidada.ownerId });
        assert.equal(sellerActions.find(action => action.actionCode === "finalizar_revision_datos")?.blockedReason, null);
        const blocked = await post(row);
        assert.equal(blocked.status, 409);
        assert.match(await blocked.text(), /no tiene registro de conciliación/);
        let saved = await read(row.id);
        assert.equal(saved.estadoActual.code, "Liquidada");
        assert.equal(saved.updatedAt.getTime(), row.updatedAt.getTime());
        await db.solicitud.update({ where: { id: row.id }, data: { estadoActualId: confirmed.id, sellerReviewStartedAt: null } });
        const riskActions = await workflow.listAvailableTransitions({ solicitudId: row.id, workflowOwnerId: confirmed.ownerId });
        for (const code of ["enviar_a_liquidada", "liquidar"]) {
          assert.match(riskActions.find(action => action.actionCode === code)?.blockedReason ?? "", /no tiene registro de conciliación/);
        }
        currentUser = analyst;
        try {
          for (const actionCode of ["enviar_a_liquidada", "liquidar", "liquidar_con_firma"]) {
            const response = await fetch(`http://127.0.0.1:${port}/solicitudes/${row.id}/transitions`, {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actionCode }),
            });
            assert.equal(response.status, 409);
            assert.match(await response.text(), /no tiene registro de conciliación/);
          }
        } finally { currentUser = seller; }
        saved = await read(row.id);
        assert.equal(saved.estadoActual.code, "Confirmada");
        assert.equal(saved.analisisFinalizadoAt, null);
        assert.equal(saved.administrativeCoreControl, null);
        assert.equal(await persistedEvents(row.id), 0);
      }
      assert.equal(financialChecks, beforeChecks);
    });
    await t.test("rechaza una versión obsoleta y el intento de una persona de Riesgo", async () => {
      const row = await makeReview();
      const changes = { titular: { celular: "2222" } };
      assert.equal((await post(row, { changes, expectedUpdatedAt: new Date(0).toISOString() })).status, 409);
      currentUser = analyst;
      try {
        assert.equal((await post(row, { changes })).status, 403);
      } finally { currentUser = seller; }
      const saved = await read(row.id);
      assert.equal(saved.estadoActual.code, "Liquidada");
      assert.equal(saved.titular?.celular, "1111");
      assert.equal(saved.updatedAt.getTime(), row.updatedAt.getTime());
      assert.equal(await persistedEvents(row.id), 0);
    });
    await t.test("un fallo financiero posterior al guardado revierte el intento completo", async () => {
      const row = await makeReview();
      rejectLoan = true;
      try {
        assert.equal((await post(row, { changes: { titular: { celular: "1111" } } })).status, 409);
      } finally { rejectLoan = false; }
      const saved = await read(row.id);
      assert.equal(saved.updatedAt.getTime(), row.updatedAt.getTime());
      assert.equal(saved.estadoActual.code, "Liquidada");
      assert.equal(saved.analisisFinalizadoAt, null);
      assert.equal(await persistedEvents(row.id), 0);
    });
    await t.test("si el motor rechaza al actor al ejecutar la transición, se revierten el teléfono, el resumen y el estado", async () => {
      const row = await makeReview();
      // Simula una cuenta ya eliminada entre la autenticación y el cierre:
      // el motor vuelve a validar al actor después de guardar el patch, bajo el mismo lock.
      currentUser = { ...seller, id: randomUUID() };
      try {
        assert.equal((await post(row, { changes: { titular: { celular: "2222" } } })).status, 403);
      } finally { currentUser = seller; }
      const saved = await read(row.id);
      assert.equal(saved.titular?.celular, "1111");
      assert.deepEqual(saved.sellerReviewChanges, []);
      assert.equal(saved.estadoActual.code, "Liquidada");
      assert.equal(saved.updatedAt.getTime(), row.updatedAt.getTime());
      assert.equal(await persistedEvents(row.id), 0);
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.solicitudEstadoHistorial.deleteMany({ where: { solicitud: { createdBy: seller.id } } });
    await db.solicitud.deleteMany({ where: { createdBy: seller.id } });
    await db.socio.delete({ where: { id: socio.id } });
    await db.user.deleteMany({ where: { id: { in: [seller.id, analyst.id] } } });
  }
});
