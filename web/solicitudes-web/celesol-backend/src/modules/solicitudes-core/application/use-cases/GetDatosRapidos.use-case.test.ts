import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GetDatosRapidosUseCase,
  type DatosRapidosGateway,
} from "./GetDatosRapidos.use-case";

const solicitud = {
  lineaPrestamoLegacyOid: "12",
  titular: { nroDocumento: "12.345.678", tipoDocumento: "DNI" },
};
function setup(overrides: Partial<DatosRapidosGateway> = {}) {
  const calls: string[] = [];
  return {
    calls,
    useCase: new GetDatosRapidosUseCase({
      lookupCbuHabitual: async (doc, tipo) => {
        calls.push(`cbu:${doc}:${tipo}`);
        return [{ id: "71", cbu: "0110000699111100000248" }];
      },
      lookupSocioRapido: async (doc, tipo) => {
        calls.push(`${doc}:${tipo}`);
        return [{ id: "71" }];
      },
      getConvenioRapido: async (id) => {
        calls.push(`linea:${id}`);
        return "Convenio superior";
      },
      getMoraRapido: async () => true,
      getCreditosActivosRapido: async (id) => {
        calls.push(`prestamos:${id}`);
        return true;
      },
      ...overrides,
    }),
  };
}
describe("Datos rápidos del solicitante", () => {
  it("confirma socio y créditos usando identidad del legado", async () => {
    const { useCase, calls } = setup();
    assert.deepEqual(await useCase.socio(solicitud), { condicion: "member" });
    assert.deepEqual(await useCase.creditos(solicitud), { activos: true });
    assert.ok(calls.includes("12345678:DNI"));
    assert.ok(calls.includes("prestamos:71"));
  });
  it("confirma ausencia de créditos solo con resultado explícito", async () => {
    const { useCase } = setup({
      getMoraRapido: async () => true,
      getCreditosActivosRapido: async () => false,
    });
    assert.deepEqual(await useCase.creditos(solicitud), { activos: false });
  });
  it("no socio confirmado no dispara préstamos", async () => {
    const { useCase, calls } = setup({ lookupSocioRapido: async () => [] });
    assert.deepEqual(await useCase.socio(solicitud), { condicion: "none" });
    assert.deepEqual(await useCase.creditos(solicitud), { activos: null });
    assert.equal(calls.length, 0);
  });
  it("coincidencias múltiples no se convierten en no socio", async () => {
    const { useCase } = setup({
      lookupSocioRapido: async () => [{ id: "1" }, { id: "2" }],
    });
    assert.deepEqual(await useCase.socio(solicitud), { condicion: "unknown" });
    assert.deepEqual(await useCase.creditos(solicitud), { activos: null });
  });
  it("errores de socio o préstamos no producen negativos", async () => {
    const error = async (): Promise<never> => {
      throw Error("unavailable");
    };
    assert.deepEqual(
      await setup({ lookupSocioRapido: error }).useCase.socio(solicitud),
      { condicion: "unknown" },
    );
    assert.deepEqual(
      await setup({
        getMoraRapido: async () => true,
        getCreditosActivosRapido: error,
      }).useCase.creditos(solicitud),
      { activos: null },
    );
  });
  it("documento ausente o inválido queda sin verificar", async () => {
    for (const documento of [null, "", "abc"]) {
      const { useCase, calls } = setup();
      assert.deepEqual(
        await useCase.socio({
          ...solicitud,
          titular: { ...solicitud.titular, nroDocumento: documento },
        }),
        { condicion: "unknown" },
      );
      assert.equal(calls.length, 0);
    }
  });
  it("convenio se consulta por línea guardada sin fallback a descripción específica", async () => {
    const { useCase, calls } = setup();
    assert.deepEqual(await useCase.convenio(solicitud), {
      descripcion: "Convenio superior",
    });
    assert.deepEqual(calls, ["linea:12"]);
    assert.deepEqual(
      await useCase.convenio({ ...solicitud, lineaPrestamoLegacyOid: null }),
      { descripcion: null },
    );
  });
  it("cada solicitud consulta a su persona, sin retener el socio anterior", async () => {
    const { useCase } = setup({
      lookupSocioRapido: async (doc) =>
        doc === "12345678" ? [{ id: "71" }] : [],
    });
    assert.deepEqual(await useCase.socio(solicitud), { condicion: "member" });
    assert.deepEqual(
      await useCase.socio({
        ...solicitud,
        titular: { nroDocumento: "999", tipoDocumento: "DNI" },
      }),
      { condicion: "none" },
    );
  });
});

describe("CBU habitual del solicitante", () => {
  it("consulta la identidad guardada en Vimarx y conserva el CBU de la solicitud", async () => {
    const { useCase, calls } = setup();
    const original = { ...solicitud, titular: { ...solicitud.titular, cbu: "otro CBU" } };
    assert.deepEqual(await useCase.cbu(original), { status: "available", cbu: "0110000699111100000248" });
    assert.deepEqual(calls, ["cbu:12345678:DNI"]);
    assert.equal(original.titular.cbu, "otro CBU");
  });
  it("distingue socio sin CBU, no socio, coincidencia ambigua y error de consulta", async () => {
    for (const [matches, status] of [
      [[{ id: "71", cbu: null }], "missing"],
      [[{ id: "71", cbu: "  " }], "missing"],
      [[], "not_member"],
      [[{ id: "71", cbu: "uno" }, { id: "72", cbu: "dos" }], "ambiguous"],
    ] as const) {
      const { useCase } = setup({ lookupCbuHabitual: async () => [...matches] });
      assert.deepEqual(await useCase.cbu(solicitud), { status, cbu: null });
    }
    const { useCase } = setup({ lookupCbuHabitual: async () => { throw Error("offline"); } });
    assert.deepEqual(await useCase.cbu(solicitud), { status: "unavailable", cbu: null });
  });
  it("no consulta documentos vacíos, inválidos o demasiado largos", async () => {
    for (const nroDocumento of [null, "", "abc", "00000000", "1234567890123"]) {
      const { useCase, calls } = setup();
      assert.deepEqual(await useCase.cbu({ ...solicitud, titular: { ...solicitud.titular, nroDocumento } }),
        { status: "unavailable", cbu: null });
      assert.deepEqual(calls, []);
    }
  });
});

describe("Mora del solicitante", () => {
  it("evalúa mora aunque no tenga préstamos activos", async () => {
    const { useCase } = setup({ getCreditosActivosRapido: async () => false });
    assert.deepEqual(await useCase.creditos(solicitud), { activos: false });
    assert.deepEqual(await useCase.mora(solicitud), { enMora: true });
  });
  it("distingue ausencia, errores y socio ambiguo", async () => {
    assert.deepEqual(
      await setup({ getMoraRapido: async () => false }).useCase.mora(solicitud),
      { enMora: false },
    );
    assert.deepEqual(
      await setup({
        getMoraRapido: async () => {
          throw Error("offline");
        },
      }).useCase.mora(solicitud),
      { enMora: null },
    );
    assert.deepEqual(
      await setup({
        lookupSocioRapido: async () => [{ id: "1" }, { id: "2" }],
      }).useCase.mora(solicitud),
      { enMora: null },
    );
  });
});
