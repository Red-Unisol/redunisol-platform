import type { SellerReviewChange, SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import { EDITABLE_FIELDS } from "./SolicitudFieldAccess";

type Value = string | null;

function valueOf(data: object | null | undefined, key: string): Value {
  const value: unknown = data && Object.hasOwn(data, key) ? Reflect.get(data, key) : null;
  return value == null || value === "" ? null : String(value);
}

function reviewFields(solicitud: SolicitudCore) {
  const result = new Map<string, Value>();
  for (const path of EDITABLE_FIELDS) {
    // La cuota resultante es una salida de la calculadora. El vendedor se fija al crear la ficha.
    if (path === "solicitud.cuotaResultante" || path === "solicitud.vendedorSolicitud") continue;
    const [group, key] = path.split(".");
    if (group === "garantias") {
      solicitud.garantias.forEach((garantia, index) => {
        result.set(`garantias.${index}.${key}`, valueOf(garantia, key));
      });
    } else {
      const section = group === "solicitud" ? solicitud : Reflect.get(solicitud, group);
      result.set(path, valueOf(section, key));
    }
  }
  // Dos localidades de Vimarx pueden compartir nombre. El ID distingue lo que
  // efectivamente se envía al generar el socio o el préstamo.
  if (solicitud.titular.localidadId) {
    result.set("titular.localidad", [solicitud.titular.localidad, `(${solicitud.titular.localidadId})`]
      .filter(Boolean).join(" "));
  }
  return result;
}

/** Compara los datos ya normalizados por el mapper; excluye IDs generados y metadatos. */
export function diffSellerReviewFields(before: SolicitudCore, after: SolicitudCore): SellerReviewChange[] {
  const original = reviewFields(before);
  const current = reviewFields(after);
  const changes: SellerReviewChange[] = [];
  for (const field of new Set([...original.keys(), ...current.keys()])) {
    const oldValue = original.get(field) ?? null;
    const newValue = current.get(field) ?? null;
    if (oldValue !== newValue) changes.push({ field, before: oldValue, after: newValue });
  }
  return changes;
}

export function readSellerReviewChanges(value: unknown): SellerReviewChange[] {
  if (!Array.isArray(value)) return [];
  return value.filter((change): change is SellerReviewChange =>
    change != null && typeof change.field === "string" &&
    (change.before === null || typeof change.before === "string") &&
    (change.after === null || typeof change.after === "string"),
  );
}

/** Conserva el valor previo al primer cambio del vendedor. Si otro actor lo pisa,
 * deja de atribuirle ese campo al vendedor. Los cambios revertidos desaparecen. */
export function mergeSellerReviewChanges(
  previous: SellerReviewChange[], edits: SellerReviewChange[], actor: "seller" | "other",
): SellerReviewChange[] {
  const net = new Map(previous.map(change => [change.field, change]));
  for (const edit of edits) {
    const prior = net.get(edit.field);
    const before = prior ? prior.before : edit.before;
    if (actor === "seller" && before !== edit.after) {
      net.set(edit.field, { field: edit.field, before, after: edit.after });
    } else {
      net.delete(edit.field);
    }
  }
  return [...net.values()];
}

/** El ingreso inicial por Motor no entrega un resumen. Los movimientos
 * internos de Riesgo conservan el último pase de Vendedores. */
export function sellerReviewHandoff(fromOwner: string, toOwner: string, value: unknown) {
  const changes = readSellerReviewChanges(value);
  if (fromOwner === "VENDEDORES" && toOwner === "RIESGO") {
    return changes.length ? { metadata: { sellerReviewChanges: changes } } : {};
  }
  if (fromOwner !== toOwner && changes.length) return { reset: true };
  return {};
}
