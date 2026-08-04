import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SolicitudNotFoundError } from "../../domain/riesgo-errors";
import type { CalculadoraMutualSolicitudSnapshot } from "../../infrastructure/services/CalculadoraMutualLegacyGateway";
import { CalculadoraMutualDatosProvider } from "./CalculadoraMutualDatosProvider";

const CORE_SNAPSHOT: CalculadoraMutualSolicitudSnapshot = {
  antiguedadLaboral: 24,
  convenio: null,
  cuitTitular: "27204091264",
  cuotaResultante: 5000,
  cuotas: 12,
  cupoDisponibleVendedor: null,
  dniTitular: "20409126",
  fechaPrimerVencimiento: "2026-08-01",
  fechaSolicitud: "2026-07-01",
  ingresos: 500000,
  lineaDescripcion: "LINEA CORE",
  lineaId: 10,
  montoAFinanciar: 50000,
  nombreCompletoTitular: "NUEVO TITULAR",
  nroSolicitud: "9000001",
  vendedor: "vendedor-core",
};

describe("CalculadoraMutualDatosProvider", () => {
  it("uses the core snapshot and enriches it with legacy historial by CUIT when the solicitud exists locally", async () => {
    let historialCalledWith: unknown;
    let legacyGetDatosCalled = false;

    const provider = new CalculadoraMutualDatosProvider({
      legacyGateway: {
        getDatos: async () => {
          legacyGetDatosCalled = true;
          throw new Error("should not call full legacy snapshot");
        },
        getHistorialByCuit: async (cuit: string | null, fecha: string | null) => {
          historialCalledWith = { cuit, fecha };
          return {
            compromisoMensualVigente: 5000,
            rechazosDelMes: 0,
            saldoPrestamosVigentes: 10000,
            situacionSocio: "Al dia",
            titularNuevo: false,
          };
        },
      } as never,
      solicitudCoreSnapshotDatasource: {
        findByLegacyOid: async () => CORE_SNAPSHOT,
      } as never,
    });

    const datos = await provider.getDatos("220999");

    assert.equal(legacyGetDatosCalled, false);
    assert.deepEqual(historialCalledWith, {
      cuit: "27204091264",
      fecha: "2026-07-01",
    });
    assert.equal(datos.nroSolicitud, "9000001");
    assert.equal(datos.lineaDescripcion, "LINEA CORE");
    assert.equal(datos.situacionSocio, "Al dia");
    assert.equal(datos.saldoPrestamosVigentes, 10000);
  });

  it("falls back entirely to the legacy gateway when the solicitud does not exist in the core", async () => {
    let legacyGetDatosCalledWith: unknown;

    const provider = new CalculadoraMutualDatosProvider({
      legacyGateway: {
        getDatos: async (oid: string) => {
          legacyGetDatosCalledWith = oid;
          return {
            nroSolicitud: "1000001",
            situacionSocio: "Lista Negra",
          } as never;
        },
        getHistorialByCuit: async () => {
          throw new Error("should not be called on the fallback path");
        },
      } as never,
      solicitudCoreSnapshotDatasource: {
        findByLegacyOid: async () => null,
      } as never,
    });

    const datos = await provider.getDatos("220844");

    assert.equal(legacyGetDatosCalledWith, "220844");
    assert.equal(datos.nroSolicitud, "1000001");
    assert.equal(datos.situacionSocio, "Lista Negra");
  });

  it("getDatosByCoreId hydrates from the core snapshot by its own id and enriches with legacy historial", async () => {
    let findByIdCalledWith: unknown;
    let historialCalledWith: unknown;

    const provider = new CalculadoraMutualDatosProvider({
      legacyGateway: {
        getHistorialByCuit: async (
          cuit: string | null,
          fecha: string | null,
        ) => {
          historialCalledWith = { cuit, fecha };
          return {
            compromisoMensualVigente: 1000,
            rechazosDelMes: 0,
            saldoPrestamosVigentes: 2000,
            situacionSocio: "Al dia",
            titularNuevo: true,
          };
        },
      } as never,
      solicitudCoreSnapshotDatasource: {
        findById: async (id: string) => {
          findByIdCalledWith = id;
          return CORE_SNAPSHOT;
        },
      } as never,
    });

    const datos = await provider.getDatosByCoreId("solicitud-uuid-1");

    assert.equal(findByIdCalledWith, "solicitud-uuid-1");
    assert.deepEqual(historialCalledWith, {
      cuit: "27204091264",
      fecha: "2026-07-01",
    });
    assert.equal(datos.nroSolicitud, "9000001");
    assert.equal(datos.titularNuevo, true);
  });

  it("getDatosByCoreId throws SolicitudNotFoundError when the id does not exist in the core", async () => {
    const provider = new CalculadoraMutualDatosProvider({
      legacyGateway: {
        getHistorialByCuit: async () => {
          throw new Error("should not be called");
        },
      } as never,
      solicitudCoreSnapshotDatasource: {
        findById: async () => null,
      } as never,
    });

    await assert.rejects(
      () => provider.getDatosByCoreId("does-not-exist"),
      SolicitudNotFoundError,
    );
  });
});
