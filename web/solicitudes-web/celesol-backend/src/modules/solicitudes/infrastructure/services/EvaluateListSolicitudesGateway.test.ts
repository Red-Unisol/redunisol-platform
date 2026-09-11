import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LegacySolicitudesUnavailableError } from "../../domain/solicitudes-errors";
import {
  buildEvaluateListRequest,
  buildSolicitudDetailDefinitionByOid,
  buildSolicitudesPrecargaDefinition,
  EvaluateListSolicitudesGateway,
} from "./EvaluateListSolicitudesGateway";

type CapturedRequest = {
  body: unknown;
  input: string | URL;
  init: RequestInit | undefined;
};

function createFetcher(response: unknown, ok = true) {
  const requests: CapturedRequest[] = [];
  const fetcher = async (input: string | URL, init?: RequestInit) => {
    requests.push({
      body:
        typeof init?.body === "string"
          ? JSON.parse(init.body)
          : init?.body ?? null,
      init,
      input,
    });

    return {
      json: async () => response,
      ok,
    };
  };

  return {
    fetcher,
    requests,
  };
}

function createGateway(response: unknown, ok = true) {
  const { fetcher, requests } = createFetcher(response, ok);
  const gateway = new EvaluateListSolicitudesGateway(
    {
      baseUrl: "https://legacy.example.com",
      timeoutMs: 1000,
    },
    fetcher,
  );

  return {
    gateway,
    requests,
  };
}

describe("EvaluateListSolicitudesGateway", () => {
  it("builds table commands with the authenticated legacy user", () => {
    const request = buildEvaluateListRequest(
      buildSolicitudesPrecargaDefinition("h'pajon"),
      50,
    );

    assert.equal(request.max, 50);
    assert.equal(request.tipo, "PreSolicitud.Module.Solicitud");
    assert.match(request.campos, /NroSolicitud/);
    assert.equal(
      request.cmd,
      "(Creado.Usuario.UserName = 'h''pajon' or EjecutivoSolicitud.Usuario.UserName = 'h''pajon' or VendedorSolicitud.Nombre = 'h''pajon') and Estado.Descripcion = 'CargaVendedor'",
    );
    assert.equal(request.cmd.includes("apajon"), false);
  });

  it("maps legacy positional rows to named response objects", async () => {
    const { gateway, requests } = createGateway([
      [
        "oid-1",
        "100",
        "30111222",
        "hpajon",
        "2026-05-05T00:00:00",
        "Ada Lovelace",
        "Personal",
        "12345.5",
        "12",
        "2222.10",
        "CargaVendedor",
        "Pendiente",
      ],
    ]);

    const rows = await gateway.getPrecarga("hpajon", 10);

    assert.equal(
      String(requests[0]?.input),
      "https://legacy.example.com/api/Empresa/EvaluateList",
    );
    assert.deepEqual(rows, [
      {
        cuotas: 12,
        cuotaResultante: "2222.10",
        estado: "CargaVendedor",
        fecha: "05/05/2026",
        id: "hpajon|2026-05-05T00:00:00|Ada Lovelace",
        lineaPrestamo: "Personal",
        montoAFinanciar: 12345.5,
        nombreCompleto: "Ada Lovelace",
        nroDocumento: "30111222",
        nroSolicitud: "100",
        oid: "oid-1",
        ultimaNovedad: "Pendiente",
        vendedorSolicitud: "hpajon",
      },
    ]);
    assert.equal(Array.isArray(rows[0]), false);
  });

  it("builds unified solicitud detail requests by oid", () => {
    const request = buildEvaluateListRequest(
      buildSolicitudDetailDefinitionByOid("239050"),
      1,
    );

    assert.equal(request.max, 1);
    assert.equal(request.tipo, "PreSolicitud.Module.Solicitud");
    assert.equal(request.cmd, "Oid = 239050");
    assert.match(request.campos, /LineaPrestamo\.Descripcion/);
    assert.match(request.campos, /MontoMaximoAFinanciar/);
    assert.match(request.campos, /MontoMaximoCuota/);
    assert.match(request.campos, /CuotaResultante/);
    assert.match(request.campos, /FechaUltimaCuota/);
  });

  it("maps unified solicitud detail rows to named sections", async () => {
    const { gateway, requests } = createGateway([
      [
        "DNI",
        41440747,
        20414407472,
        "GONZALEZ",
        "MIQUEAS IVAN",
        "1999-01-04",
        "CASEROS",
        "1488",
        "VILLA DOLORES (5870)",
        "3544465452",
        "3544432415",
        "miqueas@example.com",
        2039313,
        "2025-11-14",
        "0200322911000015391276",
        112532,
        false,
        true,
        "ARGENTINA",
        0,
        0,
        "campo de observaciones",
        6,
        "motivo",
        100007873,
        "Pagada",
        "[Pagada] ",
        333000,
        500000,
        700000,
        160000,
        143371.2,
        "2027-05-30",
        0,
        "TESORERIA",
        "Gonzalo Diaz Delmonte",
        true,
        "Perez",
        "DNI",
        30111222,
        1,
        "2000-02-03",
        "Empleado",
        100000,
        "ARGENTINA",
        "Empresa",
        "Servicios",
        0,
        "Visa",
        "Auto",
        "Propia",
        "A",
        "Calle laboral",
        "55",
        "VILLA DOLORES (5870)",
        6,
        "CLUB MUTUAL UNC CBU (920)",
        "2026-06-30",
      ],
    ]);

    const rows = await gateway.getDetailByOid("239050");

    assert.equal(requests.length, 1);
    assert.equal(
      (requests[0]?.body as { cmd?: string } | undefined)?.cmd,
      "Oid = 239050",
    );
    assert.deepEqual(rows, [
      {
        conyuge: {
          actividad: "Empleado",
          apellido: "Perez",
          fechaNacimiento: "03/02/2000",
          ingresosMensuales: 100000,
          nacionalidad: "ARGENTINA",
          nroDocumento: "30111222",
          sexo: "1",
          tipoDocumento: "DNI",
        },
        economicosLaborales: {
          actividadLaboral: "Servicios",
          antiguedad: 6,
          descuentosSueldo: 0,
          domicilioLaboralCalle: "Calle laboral",
          domicilioLaboralLocalidad: "VILLA DOLORES (5870)",
          domicilioLaboralNroPuerta: "55",
          empleador: "Empresa",
          fechaIngresoLaboral: "14/11/2025",
          montoRecibo: 2039313,
          pisoDepto: "A",
          relacionLaboral: "Servicios",
          tarjetas: "Visa",
          vehiculo: "Auto",
          vivienda: "Propia",
        },
        solicitud: {
          cuotaResultante: "143371.2",
          cuotas: 6,
          cupoTitular: 333000,
          ejecutivoSolicitud: "TESORERIA",
          estado: "Pagada",
          fechaPrimerVencimiento: "30/06/2026",
          fechaUltimaCuota: "30/05/2027",
          firmaDigitalmente: true,
          lineaPrestamoDescripcion: "CLUB MUTUAL UNC CBU (920)",
          montoAFinanciar: 500000,
          montoMaximoAFinanciar: 700000,
          montoMaximoCuota: 160000,
          motivo: "motivo",
          nroInterno: null,
          nroOperacion: "0",
          nroSolicitud: "100007873",
          observaciones: "campo de observaciones",
          ultimaNovedad: "[Pagada] ",
          vendedorSolicitud: "Gonzalo Diaz Delmonte",
        },
        titular: {
          apellido: "GONZALEZ",
          cbu: "0200322911000015391276",
          celular: "3544465452",
          cuit: "20414407472",
          domicilioCalle: "CASEROS",
          email: "miqueas@example.com",
          estadoCivil: "0",
          fechaDeNacimiento: "04/01/1999",
          fechaIngresoLaboral: "14/11/2025",
          localidad: "VILLA DOLORES (5870)",
          montoRecibo: 2039313,
          nacionalidad: "ARGENTINA",
          nombre: "MIQUEAS IVAN",
          nroDocumento: "41440747",
          nroPuerta: "1488",
          nroSocio: "112532",
          observaciones: "campo de observaciones",
          pep: "false",
          sexo: "0",
          telefono: "3544432415",
          tipoDocumento: "DNI",
          tycAceptado: true,
        },
      },
    ]);
    assert.equal(Array.isArray(rows[0]), false);
  });

  it("maps invalid responses and HTTP errors to service unavailable", async () => {
    const invalidResponse = createGateway({ unexpected: true });
    const httpError = createGateway([], false);

    await assert.rejects(
      () => invalidResponse.gateway.getPrecarga("hpajon", 10),
      LegacySolicitudesUnavailableError,
    );
    await assert.rejects(
      () => httpError.gateway.getPrecarga("hpajon", 10),
      LegacySolicitudesUnavailableError,
    );
  });

  it("maps a prestamo otorgado response with all fields (EvaluateObj)", async () => {
    const { gateway, requests } = createGateway([
      "1002560",
      610230.51,
      1508820.22,
      "2025-05-15",
      "2025-05-31",
      "2027-04-30",
      0.09,
      1.095,
      1.8127,
      2.011199596488547,
    ]);

    const prestamo = await gateway.getPrestamoOtorgadoByLegacyOid("228418");

    assert.deepEqual(prestamo, {
      capital: 610230.51,
      cft: 2.011199596488547,
      fechaEmision: "2025-05-15",
      montoPrestamo: 1508820.22,
      nroCuenta: "1002560",
      primerVencimiento: "2025-05-31",
      tea: 1.8127,
      tem: 0.09,
      tna: 1.095,
      vencimiento: "2027-04-30",
    });
    assert.equal(
      (requests[0]?.body as { cmd: string }).cmd,
      "[Oid]=228418",
    );
    assert.equal(
      (requests[0]?.body as { tipo: string }).tipo,
      "PreSolicitud.Module.Solicitud",
    );
  });

  it("returns null when the legacy has no prestamo for that Oid", async () => {
    const { gateway, requests } = createGateway([]);

    const prestamo =
      await gateway.getPrestamoOtorgadoByLegacyOid("999999999");

    assert.equal(prestamo, null);
    assert.equal(requests.length, 2);
  });

  it("interprets Vimax's 'no existe objeto' 500 as not found, not as service unavailable", async () => {
    const fetcher = async () => ({
      json: async () => ({
        detail: "No existe objeto con esas condiciones",
        status: 500,
        title: "An error occurred while processing your request.",
      }),
      ok: false,
    });
    const gateway = new EvaluateListSolicitudesGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 1000 },
      fetcher,
    );

    const prestamo = await gateway.getPrestamoOtorgadoByLegacyOid("438846");

    assert.equal(prestamo, null);
  });

  it("falls back to F.Module.Cuentas.Prestamos.Prestamo when there is no PreSolicitud linked to the Oid", async () => {
    const requests: Array<{ cmd: string; tipo: string }> = [];
    const fetcher = async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as {
        cmd: string;
        tipo: string;
      };
      requests.push(body);

      if (body.tipo === "PreSolicitud.Module.Solicitud") {
        return {
          json: async () => ({
            detail: "No existe objeto con esas condiciones",
          }),
          ok: false,
        };
      }

      return {
        json: async () => [
          "1500849",
          7050000,
          8148700,
          "2026-07-28",
          "2026-08-31",
          "2026-08-31",
          0.13,
          1.5817,
          3.3345,
          5.0247,
        ],
        ok: true,
      };
    };
    const gateway = new EvaluateListSolicitudesGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 1000 },
      fetcher,
    );

    const prestamo = await gateway.getPrestamoOtorgadoByLegacyOid("438846");

    assert.deepEqual(prestamo, {
      capital: 7050000,
      cft: 5.0247,
      fechaEmision: "2026-07-28",
      montoPrestamo: 8148700,
      nroCuenta: "1500849",
      primerVencimiento: "2026-08-31",
      tea: 3.3345,
      tem: 0.13,
      tna: 1.5817,
      vencimiento: "2026-08-31",
    });
    assert.equal(requests.length, 2);
    assert.equal(requests[1]?.cmd, "[ID]=438846");
    assert.equal(requests[1]?.tipo, "F.Module.Cuentas.Prestamos.Prestamo");
  });

  it("asks for the socio's prestamo filtered by the socio and maps the detail", async () => {
    const { gateway, requests } = createGateway([
      [
        423331,
        1004051,
        "90536",
        "Haberes",
        "Consumo",
        1584,
        "CRUZ DEL EJE -premium-",
        0.1135,
      ],
    ]);

    const prestamo = await gateway.getPrestamoDelSocio("146871", "423331");

    assert.deepEqual(prestamo, {
      asiento: "1584",
      cobrador: "Haberes",
      destino: "Consumo",
      legacyId: "423331",
      lineaPrestamoDescripcion: "CRUZ DEL EJE -premium-",
      nroCuenta: "1004051",
      ordenCompra: "90536",
      tasaInicial: 0.1135,
    });
    const body = requests[0]?.body as { cmd: string; tipo: string };
    // El filtro por socio es lo que impide ver el prestamo de otra persona.
    assert.equal(
      body.cmd,
      "[ID] = 423331 And Integrantes[Socio.ID = 146871].Count() > 0",
    );
    assert.equal(body.tipo, "F.Module.Cuentas.Prestamos.Prestamo");
  });

  it("returns null when the prestamo does not belong to the socio", async () => {
    const { gateway } = createGateway([]);

    assert.equal(await gateway.getPrestamoDelSocio("1", "423331"), null);
  });

  it("keeps only the plan installments, in order, leaving out the disbursement and payments", async () => {
    // Filas reales del prestamo 423331, desordenadas como las devuelve la API.
    const { gateway, requests } = createGateway([
      [1, "2025-08-31", 419988.31, 0, 0, 58770.31, "1004051/1", 1004051],
      [0, "2025-07-24", 2600000, 0, 0, 0, "Desembolso 17640860", 1004051],
      [0, "2025-07-31", 468000, 0, 0, 0, "1004051/0", 1004051],
      [
        19,
        "2025-08-31",
        -419988.31,
        -419988.31,
        -419988.31,
        -58770.31,
        "PG 17776618 31/8/2025",
        1004051,
      ],
    ]);

    const cuotas = await gateway.listCuotasDelPrestamo("423331");

    assert.deepEqual(
      cuotas.map((cuota) => cuota.nroCuota),
      [0, 1],
    );
    assert.deepEqual(cuotas[1], {
      capital: 58770.31,
      fecha: "2025-08-31",
      montoTotal: 419988.31,
      nroCuota: 1,
      saldoCuota: 0,
      saldoCuotaConPunitorios: 0,
    });
    assert.equal(
      (requests[0]?.body as { cmd: string }).cmd,
      "[Prestamo.ID] = 423331",
    );
  });

  it("resolves the numeric legacy user id by username", async () => {
    const { gateway, requests } = createGateway([["347"]]);

    const id = await gateway.getLegacyUserId("hpajon");

    assert.equal(id, 347);
    assert.equal(
      (requests[0]?.body as { cmd: string }).cmd,
      "UserName = 'hpajon'",
    );
    assert.equal(
      (requests[0]?.body as { tipo: string }).tipo,
      "ClasesBase.Usuario",
    );
  });

  it("returns null when the legacy user is not found", async () => {
    const { gateway } = createGateway([]);

    const id = await gateway.getLegacyUserId("unknown");

    assert.equal(id, null);
  });

  it("resolves the vendedor legacy id from the login's most recent solicitud", async () => {
    // Mismo patron que un caso real: el VendedorSolicitud.ID mas alto (212)
    // aparece en las solicitudes mas viejas y dejo de usarse; el vigente
    // (190) es el de la solicitud con el Oid mas alto, no el ID mas alto.
    const { gateway, requests } = createGateway([
      [177977, 212],
      [185811, 190],
      [207868, 190],
    ]);

    const id = await gateway.getVendedorLegacyId("aalvarez");

    assert.equal(id, 190);
    assert.equal(
      (requests[0]?.body as { cmd: string }).cmd,
      "VendedorSolicitud.Usuario.UserName = 'aalvarez'",
    );
    assert.equal(
      (requests[0]?.body as { tipo: string }).tipo,
      "PreSolicitud.Module.Solicitud",
    );
  });

  it("ignores an isolated anomaly that is not the most recent solicitud", async () => {
    const { gateway } = createGateway([
      [158005, 90],
      [220371, 200],
      [230060, 90],
    ]);

    const id = await gateway.getVendedorLegacyId("mquiroga");

    assert.equal(id, 90);
  });

  it("returns null when there is no historical solicitud for that username", async () => {
    const { gateway } = createGateway([]);

    const id = await gateway.getVendedorLegacyId("unknown");

    assert.equal(id, null);
  });
});
