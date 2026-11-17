import assert from "node:assert/strict";
import { test } from "node:test";
import type { SolicitudCoreAdjuntoResponse } from "@/modules/solicitudes/types/solicitudes-core";
import { getAdjuntosDelVisor } from "./adjuntos-del-visor";

const item = (id: string, extra: Partial<SolicitudCoreAdjuntoResponse> = {}) =>
  ({
    id,
    solicitudId: "a",
    tipoAdjunto: "Recibo de Sueldo",
    deletedAt: null,
    archivoNombre: "archivo.pdf",
    archivoPath: `solicitudes/a/adjuntos/${id}.pdf`,
    ...extra,
  }) as SolicitudCoreAdjuntoResponse;

test("receipts first, then additional documentation, without archived evaluations", () => {
  const adicional = { tipoAdjunto: "Documentación Adicional" };
  const list = [
    item("adicional-1", adicional),
    item("recibo-1"),
    item("dni", { tipoAdjunto: "DNI" }),
    item("adicional-otra-solicitud", { ...adicional, solicitudId: "b" }),
    item("adicional-borrado", { ...adicional, deletedAt: "2026-11-17" }),
    item("evaluacion-por-path", {
      ...adicional,
      archivoNombre: "planilla.xlsx",
      archivoPath: "solicitudes/a/adjuntos/evaluacion-123.xlsx",
    }),
    item("evaluacion-por-nombre", {
      ...adicional,
      archivoNombre: "Evaluacion-generacion-2026-11-17T12-00-00-000Z.xlsx",
      archivoPath: null,
    }),
    item("adicional-xlsx-del-socio", {
      ...adicional,
      archivoNombre: "movimientos.xlsx",
      archivoPath: "solicitudes/a/adjuntos/x.xlsx",
    }),
    item("recibo-2"),
  ];
  assert.deepEqual(
    getAdjuntosDelVisor(list, "a").map((adjunto) => adjunto.id),
    ["recibo-1", "recibo-2", "adicional-1", "adicional-xlsx-del-socio"],
  );
  assert.deepEqual(getAdjuntosDelVisor(list, "missing"), []);
});
