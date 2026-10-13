import assert from "node:assert/strict";
import { it } from "node:test";
import { GetRevisionPrestamoUseCase } from "./GetRevisionPrestamo.use-case";
import {
  ForbiddenSolicitudAccessError,
  SolicitudCoreNotFoundError,
} from "../../domain/solicitudes-core-errors";

function setup(
  options: {
    missing?: boolean;
    owner?: string;
    socio?: boolean;
    calculoError?: boolean;
    socioError?: boolean;
    monto?: number | null;
    cuotas?: number;
  } = {},
) {
  const calls: unknown[] = [];
  const useCase = new GetRevisionPrestamoUseCase({
    lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "2519", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
    repository: {
      findVendedorLegacyUser: async () => "SELLER",
      findById: async () =>
        options.missing
          ? null
          : ({
              titular: {
                nroDocumento: "33344455",
                tipoDocumento: "DNI",
                cuit: null,
              },
              estadoActual: { ownerId: options.owner ?? "riesgo" },
              lineaPrestamoLegacyOid: "2519",
              lineaPrestamoDescripcion: "Línea de prueba",
              cuotas: options.cuotas ?? 6,
              montoAFinanciar:
                options.monto === undefined ? 10000 : options.monto,
              fechaPrimerVencimiento: "2040-12-31",
              tasa: 99,
            } as never),
    },
    sociosRepository: {
      lookupByDocumento: async (documento: string) => {
        calls.push({ documento });
        if (options.socioError) throw new Error("Socios unavailable");
        return options.socio === false
          ? []
          : [
              {
                tipoPersona: "FISICA",
                apellido: "Pérez",
                nombre: "Juana",
                nroSocioLegacy: "143471",
                id: "local-id",
              },
            ];
      },
    } as never,
    gateway: {
      simularRevision: async (input) => {
        calls.push(input);
        if (options.calculoError) throw new Error("Simulation unavailable");
        return { fechaPrimerVencimiento: "2026-11-30", tasa: 0.165 } as never;
      },
    },
  });
  return { useCase, calls };
}
const input = {
  solicitudId: "sol-1",
  currentUser: { id: "user", workflowOwnerId: "riesgo" },
};
it("resolves the generation socio independently, uses simulation OID and omits manual date/rate", async () => {
  const { useCase, calls } = setup();
  const result = await useCase.execute(input);
  assert.deepEqual(result.titular, {
    nombreCompleto: "Pérez Juana",
    nroSocio: "143471",
  });
  assert.deepEqual(calls, [
    { documento: "33344455" },
    { capitalPuro: false, lineaId: 2519, montoAFinanciar: 10000, cuotas: 6 },
  ]);
  assert.equal(result.calculo?.fechaPrimerVencimiento, "2026-11-30");
});
it("rejects other areas before external queries", async () => {
  const { useCase, calls } = setup({ owner: "tesoreria" });
  await assert.rejects(useCase.execute(input), ForbiddenSolicitudAccessError);
  assert.deepEqual(calls, []);
});
it("allows system administrators with the existing generation exception", async () => {
  const { useCase } = setup({ owner: "tesoreria" });
  await useCase.execute({
    ...input,
    currentUser: { ...input.currentUser, isSystemAdmin: true },
  });
});
it("rejects nonexistent requests", async () => {
  await assert.rejects(
    setup({ missing: true }).useCase.execute(input),
    SolicitudCoreNotFoundError,
  );
});
it("retains titular and conditions when calculation fails", async () => {
  const { useCase } = setup({ calculoError: true });
  const result = await useCase.execute(input);
  assert.equal(result.titular.nroSocio, "143471");
  assert.equal(result.condiciones.montoAFinanciar, 10000);
  assert.equal(result.calculo, null);
  assert.ok(result.errorCalculo);
});
it("can calculate even if socio lookup fails, without inventing the generation socio", async () => {
  const result = await setup({ socioError: true }).useCase.execute(input);
  assert.equal(result.titular.nroSocio, null);
  assert.ok(result.errorTitular);
  assert.equal(result.calculo?.fechaPrimerVencimiento, "2026-11-30");
});
it("preserves missing socio and missing conditions without making up a calculation", async () => {
  const { useCase, calls } = setup({ socio: false, monto: null });
  const result = await useCase.execute(input);
  assert.deepEqual(result.titular, { nombreCompleto: null, nroSocio: null });
  assert.equal(result.calculo, null);
  assert.equal(calls.length, 1);
});

it("preserves current seller line maxima in the updated preview", async () => {
  const { useCase, calls } = setup({ monto: 20000000, cuotas: 72 });
  const result = await useCase.execute(input);
  assert.equal(result.condiciones.montoAFinanciar, 10000000);
  assert.equal(result.condiciones.cuotas, 48);
  assert.deepEqual(calls[1], {
    capitalPuro: false, lineaId: 2519, montoAFinanciar: 10000000, cuotas: 48,
  });
});
