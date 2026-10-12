import assert from "node:assert/strict";
import { it } from "node:test";
import { GetRevisionPrestamoUseCase } from "./GetRevisionPrestamo.use-case";
import {
  ForbiddenSolicitudAccessError,
  SolicitudCoreNotFoundError,
  SolicitudLineaPrestamoLegacyIdUnresolvedError,
} from "../../domain/solicitudes-core-errors";

function setup(
  options: {
    missing?: boolean;
    owner?: string;
    socio?: boolean;
    linea?: boolean;
    monto?: number | null;
  } = {},
) {
  const calls: unknown[] = [];
  const useCase = new GetRevisionPrestamoUseCase({
    repository: {
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
              cuotas: 6,
              montoAFinanciar:
                options.monto === undefined ? 10000 : options.monto,
              fechaPrimerVencimiento: "2040-12-31",
              tasa: 99,
            } as never),
    },
    sociosRepository: {
      lookupByDocumento: async (documento: string) => {
        calls.push({ documento });
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
    lineaPrestamoLegacyIdResolver: {
      resolveByPresolicitudOid: async (oid) => {
        calls.push({ oid });
        return options.linea === false
          ? null
          : { id: "2552", codigoMutual: null };
      },
    },
    gateway: {
      simularRevision: async (input) => {
        calls.push(input);
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
it("resolves the generation socio and line relationship, uses simulation OID and omits manual date/rate", async () => {
  const { useCase, calls } = setup();
  const result = await useCase.execute(input);
  assert.deepEqual(result.titular, {
    nombreCompleto: "Pérez Juana",
    nroSocio: "143471",
  });
  assert.deepEqual(calls, [
    { documento: "33344455" },
    { oid: "2519" },
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
it("does not simulate when the generation line cannot be resolved", async () => {
  const { useCase, calls } = setup({ linea: false });
  await assert.rejects(
    useCase.execute(input),
    SolicitudLineaPrestamoLegacyIdUnresolvedError,
  );
  assert.equal(calls.length, 2);
});
it("preserves missing socio and missing conditions without making up a calculation", async () => {
  const { useCase, calls } = setup({ socio: false, monto: null });
  const result = await useCase.execute(input);
  assert.deepEqual(result.titular, { nombreCompleto: null, nroSocio: null });
  assert.equal(result.calculo, null);
  assert.equal(calls.length, 1);
});
