import { PRODUCTION_SOLICITUD, type ProductionRole } from "./production-fixtures.ts";
import type { SolicitudCoreResponse, WorkflowTransition } from "../src/modules/solicitudes/types/solicitudes-core";

const owners = {
  Confirmada: { code: "RIESGO", name: "Riesgo" },
  Liquidada: { code: "VENDEDORES", name: "Vendedores" },
  RevisionRiesgo: { code: "RIESGO", name: "Riesgo" },
  VerificarFirmaYDocumentacion: { code: "LEGAJOS_DIGITALES", name: "Legajos Digitales" },
  Transferir: { code: "TESORERIA", name: "Tesorería" },
  Revisar: { code: "VENDEDORES", name: "Vendedores" },
  Desestimada: { code: "HISTORIAL", name: "Historial" },
};

type State = keyof typeof owners;

function state(code: State) {
  const owner = { ...owners[code], id: owners[code].code };
  return { code, id: code, name: code, ownerId: owner.id, owner };
}

function transition(actionCode: string, actionLabel: string, to: State): WorkflowTransition {
  return {
    id: actionCode, actionCode, actionLabel, toState: state(to), description: null, defaultComment: null,
    blockedReason: null, requiresComment: false, saveAndExit: false, sortOrder: 10,
  };
}

// Data for the operational detail page. Only the fictional request can be changed.
export function createSellerReviewFixture(initial: "Confirmada" | "Liquidada", role: ProductionRole, approved: boolean) {
  let current: State = initial;
  const base = `/solicitudes/${PRODUCTION_SOLICITUD.id}`;
  let note = PRODUCTION_SOLICITUD.observaciones;
  let version = PRODUCTION_SOLICITUD.updatedAt;
  function detail(): SolicitudCoreResponse {
    const seller = current === "Liquidada";
    const canChangeState = role === "admin" || (seller ? role === "vendedor" : role === "riesgo");
    return {
      ...PRODUCTION_SOLICITUD, observaciones: note, updatedAt: version,
      sellerReviewStartedAt: seller ? version : null, estadoActual: state(current),
      capabilities: {
        ...PRODUCTION_SOLICITUD.capabilities!, canEdit: seller && canChangeState, canChangeState,
        fieldAccess: { defaultMode: "readonly", editableFields: seller && canChangeState ? ["solicitud.observaciones"] : [], editableGroups: [] },
      },
    };
  }
  function transitions() {
    if (!detail().capabilities?.canChangeState) return [];
    if (current === "Confirmada") return [
      transition("enviar_a_liquidada", "Enviar a liquidada", "Liquidada"),
      transition("liquidar", "Enviar a firmar", "VerificarFirmaYDocumentacion"),
      transition("revisar", "Devolver al vendedor", "Revisar"),
    ];
    if (current === "Liquidada") return [
      transition("finalizar_revision_datos", "Finalizar revisión de datos", "VerificarFirmaYDocumentacion"),
      { ...transition("desestimar", "Desestimar", "Desestimada"), requiresComment: true },
    ];
    return [];
  }

  return (method: string, path: string, body: BodyInit | null | undefined): Response | null => {
    if (method === "GET") {
      if (path === base) return Response.json(detail());
      if (path === `${base}/transitions`) return Response.json(transitions());
      if (path === `${base}/lineas-prestamo`) return Response.json([]);
      if (path === `${base}/reliquidacion`) return Response.json({
        visible: false, pending: false, prepared: false, canReopen: false,
        blockedReason: null, updatedAt: version, previousLoanId: null,
      });
    }
    if (method !== "POST" || path !== `${base}/transitions` || typeof body !== "string") return null;
    const command = JSON.parse(body);
    if (!transitions().some(item => item.actionCode === command.actionCode)) return null;
    if (command.actionCode === "enviar_a_liquidada") current = "Liquidada";
    else if (command.actionCode === "finalizar_revision_datos") {
      if (command.expectedUpdatedAt !== version) return Response.json({ error: { message: "La solicitud cambió." } }, { status: 409 });
      const next = command.changes?.solicitud?.observaciones;
      if (next !== undefined && next !== note) {
        note = next;
        current = "RevisionRiesgo";
      } else current = approved ? "Transferir" : "VerificarFirmaYDocumentacion";
    } else return null;
    version = new Date(Date.parse(version) + 1000).toISOString();
    return Response.json({ solicitud: detail(), transitions: transitions() });
  };
}
