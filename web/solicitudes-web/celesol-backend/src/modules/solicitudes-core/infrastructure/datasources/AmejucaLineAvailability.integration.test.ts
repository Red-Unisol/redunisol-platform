import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import { PrismaClient } from "@prisma/client";

import type { DbClient } from "../../../../db/prisma";
import type { CreateSolicitudCoreRecord } from "../../domain/repositories/SolicitudesCoreRepository";
import { AmejucaLineUnavailableError } from "../../domain/services/AmejucaLineAvailability";
import {
  readAmejucaLineAvailability,
  setAmejucaLineAvailability,
} from "../services/AmejucaLineAvailabilityStore";
import { SolicitudesCorePrismaDatasource } from "./SolicitudesCorePrismaDatasource";

const databaseUrl = process.env.SOLICITUDES_TEST_DATABASE_URL ?? process.env.BEEX_TEST_DATABASE_URL;

it("valida asignaciones nuevas y deja operar sobre la línea ya asignada", {
  skip: !databaseUrl,
  timeout: 15000,
}, async () => {
  assert.ok(databaseUrl);
  assert.match(new URL(databaseUrl).pathname, /(^|[_/-])test([_/-]|$)/i);
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } }) as DbClient;
  const datasource = new SolicitudesCorePrismaDatasource(db);
  const userId = randomUUID();
  let original: Awaited<ReturnType<typeof readAmejucaLineAvailability>> | undefined;
  try {
    original = await readAmejucaLineAvailability(db);
    const celesol = await setAmejucaLineAvailability(db, "CELESOL", original.version, userId);
    const estadoActual = await db.workflowState.findUniqueOrThrow({ where: { code: "PreAprobada" } });
    await db.user.create({
      data: {
        id: userId,
        email: userId + "@example.test",
        legacyUser: userId,
        passwordHash: "test-only",
        workflowOwnerId: estadoActual.ownerId,
      },
    });
    const record: CreateSolicitudCoreRecord = {
      createdBy: userId,
      estadoActual,
      lineaPrestamoLegacyOid: "2519",
      lineaPrestamoDescripcion: "AMEJUCA ESPECIAL",
      cuotas: 3,
      montoAFinanciar: 120000,
      cuotaResultante: null,
      ejecutivoSolicitud: null,
      vendedorSolicitud: null,
      motivo: null,
      observaciones: null,
      firmaDigitalmente: false,
      garantias: [],
      conyuge: null,
      datosLaborales: {
        actividadLaboral: null, antiguedadLaboralMeses: null, descuentosSueldo: null,
        domicilioLaboralCalle: null, domicilioLaboralLocalidad: null,
        domicilioLaboralNroPuerta: null, domicilioLaboralPisoDepto: null,
        empleador: null, fechaIngresoLaboral: null, montoRecibo: null,
        relacionLaboral: null, tarjetas: null, vehiculo: null, vivienda: null,
      },
      titular: {
        apellidoDenominacion: "Ejemplo", nombre: "Titular",
        cbu: null, cbuNoHabitual: null, celular: null, cuit: null,
        domicilioCalle: null, email: null, localidad: null, nroDocumento: null,
        nroPuerta: null, nroSocio: null, tipoDocumento: null,
      },
    };
    const existing = await datasource.create(record);
    await setAmejucaLineAvailability(db, "RED_UNISOL", celesol.version, userId);

    await assert.rejects(datasource.create(record), AmejucaLineUnavailableError);
    const guard = { expectedEstadoActualId: estadoActual.id, enforceMontoAprobadoRiesgo: false };
    const saved = await datasource.update(existing.id, {
      solicitud: { lineaPrestamoLegacyOid: "2519", montoAFinanciar: 110000, cuotas: 2 },
    }, guard);
    assert.equal(saved.lineaPrestamoLegacyOid, "2519");
    assert.equal(saved.montoAFinanciar, 110000);
    assert.equal(saved.cuotas, 2);

    await assert.rejects(datasource.update(existing.id, {
      solicitud: { lineaPrestamoLegacyOid: "2657", observaciones: "No debe guardarse" },
    }, guard), AmejucaLineUnavailableError);
    const unchanged = await datasource.findById(existing.id);
    assert.equal(unchanged?.lineaPrestamoLegacyOid, "2519");
    assert.equal(unchanged?.observaciones, null);

    const changed = await datasource.update(existing.id, {
      solicitud: { lineaPrestamoLegacyOid: "2773", lineaPrestamoDescripcion: "AMEJUCA PREMIUM - RED UNISOL" },
    }, guard);
    assert.equal(changed.lineaPrestamoLegacyOid, "2773");
    await assert.rejects(datasource.update(existing.id, {
      solicitud: { lineaPrestamoLegacyOid: "2519" },
    }, guard), AmejucaLineUnavailableError);
    const created = await datasource.create({
      ...record,
      lineaPrestamoLegacyOid: changed.lineaPrestamoLegacyOid,
      lineaPrestamoDescripcion: changed.lineaPrestamoDescripcion,
    });
    assert.equal(created.lineaPrestamoLegacyOid, "2773");
  } finally {
    try {
      await db.solicitud.deleteMany({ where: { createdBy: userId } });
      await db.user.deleteMany({ where: { id: userId } });
      if (original) {
        await db.amejucaLineAvailability.update({
          where: { id: 1 },
          data: { ...original, updatedBy: null },
        });
      }
    } finally {
      await db.$disconnect();
    }
  }
});
