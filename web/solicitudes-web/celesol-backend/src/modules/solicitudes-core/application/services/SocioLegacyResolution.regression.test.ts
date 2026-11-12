import assert from "node:assert/strict";
import { it } from "node:test";
import { EvaluateListSolicitudesGateway } from "../../../solicitudes/infrastructure/services/EvaluateListSolicitudesGateway";
import { CalculadoraMutualLegacyGateway } from "../../../riesgo/infrastructure/services/CalculadoraMutualLegacyGateway";
import { GetDatosRapidosUseCase } from "../use-cases/GetDatosRapidos.use-case";
import { FindSolicitudTitularSocioLegacyId } from "./FindSolicitudTitularSocioLegacyId";

const titular = {
  nroDocumento: "30111222",
  tipoDocumento: "DNI",
  cuit: "20301112223",
};
function setup(candidates: unknown) {
  const calls: { campos: string; cmd: string; tipo: string }[] = [];
  const fetcher = async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    let data: unknown = [];
    if (body.campos === "ID;NroDoc;CUIT;TipoDoc.Descripcion") data = candidates;
    else if (body.campos === "ID;CuentaBancariaHabitual.CBU")
      data = [[71, "0110000699111100000248"]];
    else if (
      body.campos === "ID;CUIT;[Renovaciones Final];[Rechazos en el Mes]"
    )
      data = [[71, 20301112223, "Al dia", 0]];
    else if (body.campos === "DeudaTotal") data = [[1000]];
    else if (body.campos === "MontoTotal") data = [[100]];
    else if (body.campos === "ID") data = [[71]];
    return { ok: true, json: async () => data };
  };
  const config = { baseUrl: "https://legacy.example", timeoutMs: 1000 };
  const gateway = new EvaluateListSolicitudesGateway(config, fetcher);
  return {
    calls,
    datos: new GetDatosRapidosUseCase(gateway),
    find: new FindSolicitudTitularSocioLegacyId({ gateway }),
    riesgo: new CalculadoraMutualLegacyGateway(config, fetcher),
  };
}

it("un DNI duplicado con CUIT faltante usa el mismo socio en préstamos, CBU e historial", async () => {
  // Ambos registros pueden tener préstamos históricos: no se desempata por
  // orden, antigüedad, cantidad de préstamos ni presencia de una cuenta bancaria.
  const { calls, datos, find, riesgo } = setup([
    [72, 30111222, null, "DNI"],
    [71, 30111222, 20301112223, "DNI"],
  ]);
  const solicitud = { titular, lineaPrestamoLegacyOid: null };
  assert.equal(await find.execute(titular), "71");
  assert.deepEqual(await datos.socio(solicitud), { condicion: "member" });
  assert.deepEqual(await datos.creditos(solicitud), { activos: true });
  assert.deepEqual(await datos.cbu(solicitud), {
    status: "available",
    cbu: "0110000699111100000248",
  });
  const historial = await riesgo.getHistorialDelTitular(titular, "2026-11-12");
  assert.equal(historial.saldoPrestamosVigentes, 1000);
  assert.equal(historial.compromisoMensualVigente, 100);
  assert.equal(historial.titularNuevo, false);
  for (const query of calls.filter(
    (call) => call.campos !== "ID;NroDoc;CUIT;TipoDoc.Descripcion",
  )) {
    assert.match(query.cmd, /(?:ID\]|Socio.ID)\s*=\s*71/);
    assert.doesNotMatch(query.cmd, /72|CUIT/);
  }
});

it("identidades igualmente compatibles quedan ambiguas y no exponen datos financieros", async () => {
  const { calls, datos, find, riesgo } = setup([
    [72, 30111222, 20301112223, "DNI"],
    [71, 30111222, 20301112223, "DNI"],
  ]);
  const solicitud = { titular, lineaPrestamoLegacyOid: null };
  assert.equal(await find.execute(titular), null);
  assert.deepEqual(await datos.socio(solicitud), { condicion: "unknown" });
  assert.deepEqual(await datos.creditos(solicitud), { activos: null });
  assert.deepEqual(await datos.cbu(solicitud), {
    status: "ambiguous",
    cbu: null,
  });
  assert.deepEqual(await riesgo.getHistorialDelTitular(titular, "2026-11-12"), {
    compromisoMensualVigente: null,
    rechazosDelMes: null,
    saldoPrestamosVigentes: null,
    situacionSocio: null,
    titularNuevo: null,
  });
  assert.ok(
    calls.every((call) => call.campos === "ID;NroDoc;CUIT;TipoDoc.Descripcion"),
  );
});

it("el historial también se puede resolver por documento cuando falta CUIT en la solicitud", async () => {
  const { riesgo, calls } = setup([[71, 30111222, null, "DNI"]]);
  const historial = await riesgo.getHistorialDelTitular(
    { ...titular, cuit: null },
    "2026-11-12",
  );
  assert.equal(historial.saldoPrestamosVigentes, 1000);
  assert.match(
    calls.find((call) => call.campos === "DeudaTotal")!.cmd,
    /Socio.ID\]=71/,
  );
});
