import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EvaluateListSolicitudesGateway } from "./EvaluateListSolicitudesGateway";
function setup(responses: unknown[]) {
  const calls: Array<{
    campos: string;
    cmd: string;
    max: number;
    tipo: string;
  }> = [];
  const gateway = new EvaluateListSolicitudesGateway(
    { baseUrl: "https://legacy.example", timeoutMs: 1000 },
    async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return { ok: true, json: async () => responses.shift() };
    },
  );
  return { gateway, calls };
}
describe("Consultas legacy de datos rápidos", () => {
  it("resuelve la línea de la solicitud y pide exclusivamente su superior sin requerir un préstamo", async () => {
    const { gateway, calls } = setup([[["Convenio"]]]);
    assert.equal(await gateway.getConvenioRapido("12"), "Convenio");
    assert.equal(calls[0].tipo, "F.Module.Cuentas.Prestamos.LineaPrestamo");
    assert.equal(calls[0].campos, "Superior.Descripcion");
    assert.equal(calls[0].cmd, "[LineaSolicitud.Oid] = 12");
  });
  it("no elige convenio cuando falta el superior o hay varias líneas candidatas", async () => {
    for (const response of [[], [[null]], [["  "]], [["A"], ["B"]]]) {
      assert.equal(
        await setup([response]).gateway.getConvenioRapido("12"),
        null,
      );
    }
  });
  it("busca hasta dos socios para detectar ambigüedad y escapa tipo documento", async () => {
    const { gateway, calls } = setup([[[1], [2]]]);
    assert.equal((await gateway.lookupSocioRapido("123", "D'NI")).length, 2);
    assert.equal(calls[0].max, 2);
    assert.match(calls[0].cmd, /D''NI/);
  });
  it("consulta existencia activa sin límite del listado ni filtro de convenio", async () => {
    const { gateway, calls } = setup([[[99]]]);
    assert.equal(await gateway.getCreditosActivosRapido("71"), true);
    assert.equal(
      calls[0].cmd,
      "(Integrantes[Socio.ID = 71].Count() > 0) And ([Estado] = 0)",
    );
    assert.equal(calls[0].max, 1);
    assert.equal(calls.length, 1);
  });
  it("ausencia requiere descartar estado desconocido", async () => {
    assert.equal(
      await setup([[], []]).gateway.getCreditosActivosRapido("71"),
      false,
    );
    assert.equal(
      await setup([[], [[8]]]).gateway.getCreditosActivosRapido("71"),
      null,
    );
  });
  it("respuestas malformadas e ids inseguros fallan, nunca retornan ausencia", async () => {
    for (const response of [{}, ["error"], [[]], [[null]]]) {
      await assert.rejects(() =>
        setup([response]).gateway.lookupSocioRapido("123"),
      );
    }
    const { gateway, calls } = setup([]);
    await assert.rejects(() => gateway.getCreditosActivosRapido("1 OR 1=1"));
    assert.equal(calls.length, 0);
  });
});

describe("Mora independiente de la vigencia del préstamo", () => {
  it("detecta una cuota vencida impaga del préstamo 130338", async () => {
    const { gateway, calls } = setup([[[1, "130338/1", 130338]]]);
    assert.equal(
      await gateway.getMoraRapido("71", new Date("2026-10-11T12:00:00Z")),
      true,
    );
    assert.match(calls[0].cmd, /SaldoCuota\] > 0\.0m/);
    assert.match(calls[0].cmd, /Fecha\] < #2026-10-11#/);
    assert.doesNotMatch(calls[0].cmd, /Vigente|Estado|FechaCobro/);
  });
  it("excluye pagos y desembolsos aunque aparezcan en la respuesta", async () => {
    assert.equal(
      await setup([
        [
          [1, "PG 123", 130338],
          [0, "Desembolso 123", 130338],
        ],
      ]).gateway.getMoraRapido("71"),
      false,
    );
    assert.equal(await setup([[]]).gateway.getMoraRapido("71"), false);
  });
  it("usa el día argentino y no el día UTC siguiente", async () => {
    const { gateway, calls } = setup([[]]);
    await gateway.getMoraRapido("71", new Date("2026-10-12T01:00:00Z"));
    assert.match(calls[0].cmd, /#2026-10-11#/);
  });
  it("no confirma ausencia con truncamiento o una respuesta inválida", async () => {
    assert.equal(
      await setup([
        Array.from({ length: 2000 }, () => [1, "PG 123", 130338]),
      ]).gateway.getMoraRapido("71"),
      null,
    );
    for (const response of [{}, [null], [[1, null, 130338]]]) {
      await assert.rejects(() => setup([response]).gateway.getMoraRapido("71"));
    }
    await assert.rejects(() => setup([]).gateway.getMoraRapido("1 OR 1=1"));
  });
});

it("preserva Estado=0 en el listado aun con Vigente=false",async()=>{
 const {gateway,calls}=setup([[[386586,130338,false,"COMER RECURRENTE CBU",null,20000,20000,18000,-23979.88,null,null,0]]]);
 const [prestamo]=await gateway.listPrestamosDelSocio("71");
 assert.equal(prestamo.estado,0);
 assert.equal(prestamo.montoADesembolsar,18000);
 assert.equal(prestamo.saldo,-23979.88);
 assert.equal(prestamo.vigente,false);
 assert.match(calls[0].campos,/;Estado$/);
});
