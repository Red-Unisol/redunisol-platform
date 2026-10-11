import assert from "node:assert/strict";
import { it } from "node:test";
import { EvaluateListSolicitudesGateway } from "./EvaluateListSolicitudesGateway";

const fields =
  "NroSolicitud;Fecha;Estado.Descripcion;VendedorSolicitud.Nombre;Creado.Usuario.UserName;Linea.Descripcion;MontoAFinanciar;MontoADesembolsar;Cuotas;CuotaResultante;Prestamo.NroCuenta;NroSocio;NroDocumento;NombreCompleto";
it("consulta solo el documento con la proyección exacta y mapea las 14 posiciones", async () => {
  const requests: RequestInit[] = [];
  const gateway = new EvaluateListSolicitudesGateway(
    { baseUrl: "https://example.test", timeoutMs: 1000 },
    async (url, init) => {
      assert.equal(
        String(url),
        "https://example.test/api/Empresa/EvaluateList",
      );
      requests.push(init!);
      return {
        ok: true,
        json: async () => [
          [
            123,
            "2020-02-03T00:00:00",
            "Histórico",
            "Vendedor",
            "creador",
            "Línea",
            "1000.25",
            null,
            12,
            100,
            456,
            "",
            12345678,
            "Persona Prueba",
          ],
        ],
      };
    },
  );
  assert.deepEqual(await gateway.listSolicitudesDelTitular("12345678"), [
    {
      nroSolicitud: "123",
      fecha: "2020-02-03T00:00:00",
      estado: "Histórico",
      vendedor: "Vendedor",
      usuarioCreador: "creador",
      linea: "Línea",
      montoAFinanciar: 1000.25,
      montoADesembolsar: null,
      cuotas: 12,
      cuotaResultante: 100,
      nroCuentaPrestamo: "456",
      nroSocio: null,
      nroDocumento: "12345678",
      nombreCompleto: "Persona Prueba",
    },
  ]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0].body)), {
    cmd: "Socio.NroDoc = 12345678",
    tipo: "PreSolicitud.Module.Solicitud",
    campos: fields,
    max: 50,
  });
});
it("distingue vacío de respuestas incorrectas y fallos remotos", async () => {
  for (const response of [[], {}, ["incorrecto"], [[1, 2]]]) {
    const gateway = new EvaluateListSolicitudesGateway(
      { baseUrl: "https://example.test", timeoutMs: 1000 },
      async () => ({ ok: true, json: async () => response }),
    );
    if (Array.isArray(response) && response.length === 0)
      assert.deepEqual(await gateway.listSolicitudesDelTitular("12345678"), []);
    else
      await assert.rejects(() => gateway.listSolicitudesDelTitular("12345678"));
  }
  const gateway = new EvaluateListSolicitudesGateway(
    { baseUrl: "https://example.test", timeoutMs: 1000 },
    async () => ({ ok: false, json: async () => [] }),
  );
  await assert.rejects(() => gateway.listSolicitudesDelTitular("12345678"));
});
it("rechaza documentos inseguros antes de consultar", async () => {
  let calls = 0;
  const gateway = new EvaluateListSolicitudesGateway(
    { baseUrl: "https://example.test", timeoutMs: 1000 },
    async () => {
      calls++;
      return { ok: true, json: async () => [] };
    },
  );
  for (const doc of ["", "0", "123 OR 1=1", "12.345", "1234567890123"])
    await assert.rejects(() => gateway.listSolicitudesDelTitular(doc));
  assert.equal(calls, 0);
});

it("limita a 50 sin consultas adicionales y conserva campos vacíos como null", async () => {
  let calls = 0;
  const gateway = new EvaluateListSolicitudesGateway(
    { baseUrl: "https://example.test", timeoutMs: 1000 },
    async () => {
      calls++;
      return { ok: true, json: async () => Array.from({ length: 51 }, () => Array(14).fill(null)) };
    },
  );
  const rows = await gateway.listSolicitudesDelTitular("12345678");
  assert.equal(rows.length, 50);
  assert.equal(calls, 1);
  assert(Object.values(rows[0]).every((value) => value === null));
});
