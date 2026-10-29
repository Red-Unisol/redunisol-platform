import assert from "node:assert/strict";
import { it } from "node:test";
import { ADMIN_CORRECTION_ACTION, assertCoreReconciled, coreConditionsFingerprint, coreReconciliationPending } from "./AdministrativeCorrection";
import { SolicitudTransitionPolicy } from "./SolicitudTransitionPolicy";
import type { WorkflowValidationContext } from "./types";

const source = () => ({
  legacyOid: "123", montoAFinanciar: "600000", cuotas: 12, lineaPrestamoLegacyOid: "5",
  fechaPrimerVencimiento: new Date("2026-11-01"),
  titular: { nroDocumento: "12345678", nroSocio: "90", cuit: "20123456789" },
  cancelaciones: [{ id: "cancel-1", monto: "10000", deletedAt: null }],
  administrativeCoreControl: {} as Record<string, unknown>,
});

it("a linked loan stays blocked until reconciled; every loan input invalidates reconciliation", () => {
  const s = source();
  assert(coreReconciliationPending(s));
  assert.throws(() => assertCoreReconciled(s, "liquidar"));
  assert.doesNotThrow(() => assertCoreReconciled(s, "desestimar"));
  s.administrativeCoreControl = { loanId: s.legacyOid, reconciledFingerprint: coreConditionsFingerprint(s) };
  assert(!coreReconciliationPending(s));
  const changes = [
    { legacyOid: "456" }, { montoAFinanciar: "600001" }, { cuotas: 24 },
    { lineaPrestamoLegacyOid: "6" }, { fechaPrimerVencimiento: new Date("2026-12-01") },
    { titular: { ...s.titular, nroDocumento: "999" } },
    { cancelaciones: [{ ...s.cancelaciones[0]!, monto: "20000" }] },
  ];
  for (const patch of changes) {
    const changed = { ...s, ...patch };
    assert(coreReconciliationPending(changed));
    for (const action of ["liquidar", "verificar_firma", "transferir", "pagar"])
      assert.throws(() => assertCoreReconciled(changed, action));
  }
});

it("existing solicitudes without administrative correction keep their workflow", () => {
  assert(!coreReconciliationPending({ ...source(), administrativeCoreControl: null }));
});

it("reserved action requires an administrator, structured correction and reason", () => {
  const context: WorkflowValidationContext = {
    command: { actionCode: ADMIN_CORRECTION_ACTION, changedBy: "admin", now: new Date(),
      solicitudId: "sol", workflowOwnerId: "", isSystemAdmin: true, comment: "Corrección por error",
      administrativeCorrection: { expectedUpdatedAt: new Date().toISOString(), requestId: "req" } },
    transitionValidation: { solicitud: { estadoActualId: "confirmada", ownerId: "riesgo" },
      transition: { isActive: true, requiresComment: true, toStateIsActive: true } },
  };
  const policy = new SolicitudTransitionPolicy();
  assert.doesNotThrow(() => policy.validate(context));
  for (const patch of [{ isSystemAdmin: false }, { administrativeCorrection: undefined }, { comment: " " }])
    assert.throws(() => policy.validate({ ...context, command: { ...context.command, ...patch } }));
});

it("an uncertain loan replacement freezes every workflow action, including exits", () => {
  const s = { ...source(), administrativeCoreControl: { replacementPending: "operation-id" } };
  for (const action of ["liquidar", "desestimar", "confirmar", "enviar_a_riesgo"])
    assert.throws(() => assertCoreReconciled(s, action), /reemplazo/);
});
