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
  it("consulta existencia vigente sin límite del listado ni filtro de convenio", async () => {
    const { gateway, calls } = setup([[[99]]]);
    assert.equal(await gateway.getCreditosVigentesRapido("71"), true);
    assert.equal(
      calls[0].cmd,
      "(Integrantes[Socio.ID = 71].Count() > 0) And ([Vigente] = True)",
    );
    assert.equal(calls[0].max, 1);
    assert.equal(calls.length, 1);
  });
  it("ausencia requiere descartar vigencia desconocida", async () => {
    assert.equal(
      await setup([[], []]).gateway.getCreditosVigentesRapido("71"),
      false,
    );
    assert.equal(
      await setup([[], [[8]]]).gateway.getCreditosVigentesRapido("71"),
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
    await assert.rejects(() => gateway.getCreditosVigentesRapido("1 OR 1=1"));
    assert.equal(calls.length, 0);
  });
});
