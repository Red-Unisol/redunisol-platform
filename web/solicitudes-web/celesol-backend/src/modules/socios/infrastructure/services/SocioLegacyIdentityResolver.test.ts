import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SocioLegacyIdentityResolver,
  SocioLegacyIdentityUnavailableError,
} from "./SocioLegacyIdentityResolver";

const titular = {
  nroDocumento: "30.111.222",
  tipoDocumento: " dni ",
  cuit: "20-30111222-3",
};
const real = [71, 30111222, 20301112223, "DNI"];
const duplicate = [72, 30111222, null, "DNI"];
function setup(body: unknown, ok = true) {
  const calls: { campos: string; cmd: string; max: number }[] = [];
  const resolver = new SocioLegacyIdentityResolver(
    { baseUrl: "https://legacy.example", timeoutMs: 100 },
    async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return { ok, json: async () => body };
    },
  );
  return { resolver, calls };
}

describe("Identidad del socio en Vimarx", () => {
  it("desempata el documento duplicado por CUIT exacto, independientemente del orden", async () => {
    for (const rows of [
      [duplicate, real],
      [real, duplicate],
    ]) {
      const { resolver, calls } = setup(rows);
      assert.deepEqual(await resolver.resolve(titular), {
        status: "single",
        id: "71",
      });
      assert.equal(calls[0]!.campos, "ID;NroDoc;CUIT;TipoDoc.Descripcion");
      assert.match(calls[0]!.cmd, /NroDoc\] = 30111222/);
      assert.match(calls[0]!.cmd, /CUIT\] = '20301112223'/);
      assert.doesNotMatch(calls[0]!.campos, /CBU|Nombre|Saldo|Prestamos/);
    }
  });
  it("no decide entre dos registros con la misma identidad completa", async () => {
    assert.deepEqual(
      await setup([real, [72, ...real.slice(1)]]).resolver.resolve(titular),
      { status: "ambiguous", ids: ["71", "72"] },
    );
  });
  it("preserva el respaldo por documento para un socio sin CUIT", async () => {
    assert.deepEqual(await setup([duplicate]).resolver.resolve(titular), {
      status: "single",
      id: "72",
    });
    assert.deepEqual(
      await setup([duplicate]).resolver.resolve({ ...titular, cuit: null }),
      { status: "single", id: "72" },
    );
  });
  it("sin CUIT en la solicitud los documentos duplicados siguen siendo ambiguos", async () => {
    assert.equal(
      (
        await setup([duplicate, real]).resolver.resolve({
          ...titular,
          cuit: null,
        })
      ).status,
      "ambiguous",
    );
  });
  it("un CUIT contradictorio o un documento distinto no se convierten en coincidencia ni ausencia", async () => {
    for (const row of [
      [71, 30111222, 27301112224, "DNI"],
      [71, 30999888, 20301112223, "DNI"],
    ]) {
      await assert.rejects(
        setup([row]).resolver.resolve(titular),
        SocioLegacyIdentityUnavailableError,
      );
    }
  });
  it("consulta por CUIT cuando no hay documento y contempla jurídicas con CUIT en NroDoc", async () => {
    const { resolver, calls } = setup([real]);
    assert.deepEqual(await resolver.resolve({ cuit: titular.cuit }), {
      status: "single",
      id: "71",
    });
    assert.match(calls[0]!.cmd, /NroDoc\] = 20301112223/);
    assert.deepEqual(
      await setup([[73, 30711222339, null, "CUIT"]]).resolver.resolve({
        cuit: "30711222339",
      }),
      { status: "single", id: "73" },
    );
  });
  it("un CUIT exacto permite resolver un registro con documento faltante", async () => {
    assert.deepEqual(
      await setup([[71, null, 20301112223, null]]).resolver.resolve(titular),
      { status: "single", id: "71" },
    );
  });
  it("sin CUIT exacto respeta el tipo documental", async () => {
    await assert.rejects(
      setup([[71, 30111222, null, "LC"]]).resolver.resolve(titular),
      SocioLegacyIdentityUnavailableError,
    );
  });
  it("no confirma una coincidencia si se alcanzó el límite de candidatos", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => [
      i + 1,
      30111222,
      i ? null : 20301112223,
      "DNI",
    ]);
    await assert.rejects(
      setup(rows).resolver.resolve(titular),
      SocioLegacyIdentityUnavailableError,
    );
  });
  it("cero filas confirma ausencia, mientras errores y respuestas inválidas quedan sin verificar", async () => {
    assert.deepEqual(await setup([]).resolver.resolve(titular), {
      status: "none",
    });
    for (const body of [
      null,
      {},
      [null],
      [[71]],
      [[71, 30111222, false, "DNI"]],
      [real, real],
    ]) {
      await assert.rejects(
        setup(body).resolver.resolve(titular),
        SocioLegacyIdentityUnavailableError,
      );
    }
    await assert.rejects(
      setup([], false).resolver.resolve(titular),
      SocioLegacyIdentityUnavailableError,
    );
  });
  it("rechaza criterios inyectados e identidades inválidas antes de consultar", async () => {
    for (const input of [
      {},
      { nroDocumento: "0" },
      { nroDocumento: "1 Or 1=1" },
      { cuit: "123" },
      { ...titular, cuit: "invalid" },
    ]) {
      const { resolver, calls } = setup([]);
      await assert.rejects(
        resolver.resolve(input),
        SocioLegacyIdentityUnavailableError,
      );
      assert.equal(calls.length, 0);
    }
    const { resolver, calls } = setup([]);
    await resolver.resolve({ nroDocumento: "123", tipoDocumento: "D'NI" });
    assert.match(calls[0]!.cmd, /D''NI/);
  });
});
