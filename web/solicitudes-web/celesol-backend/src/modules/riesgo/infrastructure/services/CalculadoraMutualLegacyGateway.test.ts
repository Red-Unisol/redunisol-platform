import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CalculadoraMutualLegacyUnavailableError,
  SolicitudNotFoundError,
} from "../../domain/riesgo-errors";
import { CalculadoraMutualLegacyGateway } from "./CalculadoraMutualLegacyGateway";

type CapturedRequest = {
  body: { campos: string; cmd: string; max: number; tipo: string };
};

function createRoutingFetcher(
  responsesByTipo: Record<string, unknown>,
  ok = true,
) {
  const requests: CapturedRequest[] = [];
  const fetcher = async (_input: string | URL, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as CapturedRequest["body"];
    requests.push({ body });

    return {
      json: async () => responsesByTipo[body.tipo] ?? [],
      ok,
    };
  };

  return { fetcher, requests };
}

function createGateway(
  responsesByTipo: Record<string, unknown>,
  ok = true,
) {
  const { fetcher, requests } = createRoutingFetcher(responsesByTipo, ok);
  const gateway = new CalculadoraMutualLegacyGateway(
    { baseUrl: "https://legacy.example.com", timeoutMs: 1000 },
    fetcher,
  );

  return { gateway, requests };
}

const SOLICITUD_ROW: (string | number | null)[] = [
  220844,
  "1000001",
  "2026-06-01T00:00:00",
  "ADA LOVELACE",
  "20409126",
  27204091264,
  100000,
  6,
  18500.5,
  "2026-07-10T00:00:00",
  2519,
  "AMEJUCA ESPECIAL",
  "AMEJUCA",
  "hpajon",
  850000,
  36,
  300000,
];

describe("CalculadoraMutualLegacyGateway", () => {
  it("hydrates all fields for a solicitud with an existing titular", async () => {
    const { gateway, requests } = createGateway({
      "F.Module.Cuentas.Prestamos.CuotaPrestamo": [[15000], [5000]],
      "F.Module.Cuentas.Prestamos.Prestamo": [[10000], [20000]],
      "F.Module.SocioMutual": [[143471, 27204091264, "Al dia", 0]],
      "PreSolicitud.Module.Solicitud": [SOLICITUD_ROW],
    });

    const datos = await gateway.getDatos("220844");

    assert.equal(datos.nroSolicitud, "1000001");
    assert.equal(datos.fechaSolicitud, "2026-06-01");
    assert.equal(datos.nombreCompletoTitular, "ADA LOVELACE");
    assert.equal(datos.dniTitular, "20409126");
    assert.equal(datos.cuitTitular, "27204091264");
    assert.equal(datos.montoAFinanciar, 100000);
    assert.equal(datos.cuotas, 6);
    assert.equal(datos.cuotaResultante, 18500.5);
    assert.equal(datos.fechaPrimerVencimiento, "2026-07-10");
    assert.equal(datos.lineaId, 2519);
    assert.equal(datos.lineaDescripcion, "AMEJUCA ESPECIAL");
    assert.equal(datos.convenio, "AMEJUCA");
    assert.equal(datos.vendedor, "hpajon");
    assert.equal(datos.ingresos, 850000);
    assert.equal(datos.antiguedadLaboral, 36);
    assert.equal(datos.cupoDisponibleVendedor, 300000);
    assert.equal(datos.situacionSocio, "Al dia");
    assert.equal(datos.rechazosDelMes, 0);
    assert.equal(datos.saldoPrestamosVigentes, 30000);
    assert.equal(datos.compromisoMensualVigente, 20000);
    assert.equal(datos.titularNuevo, false);

    const solicitudRequest = requests.find(
      (request) => request.body.tipo === "PreSolicitud.Module.Solicitud",
    );
    assert.equal(solicitudRequest?.body.cmd, "[Oid]=220844");

    const titularNuevoRequest = requests.find(
      (request) =>
        request.body.tipo === "F.Module.SocioMutual" &&
        request.body.cmd.includes("FechaAlta"),
    );
    assert.equal(
      titularNuevoRequest?.body.cmd,
      "[CUIT]=27204091264 AND [FechaAlta]<=#2026-06-01#",
    );

    const saldoRequest = requests.find(
      (request) =>
        request.body.tipo === "F.Module.Cuentas.Prestamos.Prestamo",
    );
    assert.equal(
      saldoRequest?.body.cmd,
      "[SocioTitular.Socio.CUIT]=27204091264",
    );
  });

  it("marks titular as nuevo when no prior socio record exists before the fecha", async () => {
    const { gateway } = createGateway({
      "F.Module.Cuentas.Prestamos.CuotaPrestamo": [],
      "F.Module.Cuentas.Prestamos.Prestamo": [],
      "F.Module.SocioMutual": [],
      "PreSolicitud.Module.Solicitud": [SOLICITUD_ROW],
    });

    const datos = await gateway.getDatos("220844");

    assert.equal(datos.titularNuevo, true);
    assert.equal(datos.saldoPrestamosVigentes, 0);
    assert.equal(datos.compromisoMensualVigente, 0);
    assert.equal(datos.situacionSocio, "SIN DATOS");
    assert.equal(datos.rechazosDelMes, null);
  });

  it("returns snapshot-only data when the solicitud has no CUIT loaded yet", async () => {
    const rowWithoutCuit = [...SOLICITUD_ROW];
    rowWithoutCuit[5] = null;

    const { gateway, requests } = createGateway({
      "PreSolicitud.Module.Solicitud": [rowWithoutCuit],
    });

    const datos = await gateway.getDatos("220844");

    assert.equal(datos.cuitTitular, null);
    assert.equal(datos.titularNuevo, null);
    assert.equal(datos.saldoPrestamosVigentes, null);
    assert.equal(datos.compromisoMensualVigente, null);
    assert.equal(datos.situacionSocio, null);
    assert.equal(
      requests.filter((r) => r.body.tipo === "F.Module.SocioMutual").length,
      0,
    );
  });

  it("throws SolicitudNotFoundError when the legacy returns no rows", async () => {
    const { gateway } = createGateway({
      "PreSolicitud.Module.Solicitud": [],
    });

    await assert.rejects(
      () => gateway.getDatos("999999"),
      SolicitudNotFoundError,
    );
  });

  it("degrades gracefully when only one of the parallel historial calls fails", async () => {
    const fetcher = async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as CapturedRequest["body"];

      if (body.tipo === "F.Module.Cuentas.Prestamos.CuotaPrestamo") {
        return { json: async () => [], ok: false };
      }

      const responsesByTipo: Record<string, unknown> = {
        "F.Module.Cuentas.Prestamos.Prestamo": [[10000], [20000]],
        "F.Module.SocioMutual": [[143471, 27204091264, "Al dia", 0]],
        "PreSolicitud.Module.Solicitud": [SOLICITUD_ROW],
      };

      return { json: async () => responsesByTipo[body.tipo] ?? [], ok: true };
    };
    const gateway = new CalculadoraMutualLegacyGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 1000 },
      fetcher,
    );

    const datos = await gateway.getDatos("220844");

    assert.equal(datos.compromisoMensualVigente, null);
    assert.equal(datos.saldoPrestamosVigentes, 30000);
    assert.equal(datos.situacionSocio, "Al dia");
    assert.equal(datos.rechazosDelMes, 0);
    assert.equal(datos.titularNuevo, false);
  });

  it("throws CalculadoraMutualLegacyUnavailableError when the legacy responds with an error status", async () => {
    const { gateway } = createGateway(
      { "PreSolicitud.Module.Solicitud": [] },
      false,
    );

    await assert.rejects(
      () => gateway.getDatos("220844"),
      CalculadoraMutualLegacyUnavailableError,
    );
  });
});
