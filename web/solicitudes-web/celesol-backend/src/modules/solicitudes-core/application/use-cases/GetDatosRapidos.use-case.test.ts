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
      lookupSocioRapido: async (doc, tipo) => {
        calls.push(`${doc}:${tipo}`);
        return [{ id: "71" }];
      },
      getConvenioRapido: async (id) => {
        calls.push(`linea:${id}`);
        return "Convenio superior";
      },
      getCreditosVigentesRapido: async (id) => {
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
    assert.deepEqual(await useCase.creditos(solicitud), { vigentes: true });
    assert.ok(calls.includes("12345678:DNI"));
    assert.ok(calls.includes("prestamos:71"));
  });
  it("confirma ausencia de créditos solo con resultado explícito", async () => {
    const { useCase } = setup({ getCreditosVigentesRapido: async () => false });
    assert.deepEqual(await useCase.creditos(solicitud), { vigentes: false });
  });
  it("no socio confirmado no dispara préstamos", async () => {
    const { useCase, calls } = setup({ lookupSocioRapido: async () => [] });
    assert.deepEqual(await useCase.socio(solicitud), { condicion: "none" });
    assert.deepEqual(await useCase.creditos(solicitud), { vigentes: null });
    assert.equal(calls.length, 0);
  });
  it("coincidencias múltiples no se convierten en no socio", async () => {
    const { useCase } = setup({
      lookupSocioRapido: async () => [{ id: "1" }, { id: "2" }],
    });
    assert.deepEqual(await useCase.socio(solicitud), { condicion: "unknown" });
    assert.deepEqual(await useCase.creditos(solicitud), { vigentes: null });
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
      await setup({ getCreditosVigentesRapido: error }).useCase.creditos(
        solicitud,
      ),
      { vigentes: null },
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
