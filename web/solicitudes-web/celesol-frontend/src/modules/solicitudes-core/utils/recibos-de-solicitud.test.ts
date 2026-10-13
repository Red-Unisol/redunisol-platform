import assert from "node:assert/strict";
import { test } from "node:test";
import type { SolicitudCoreAdjuntoResponse } from "@/modules/solicitudes/types/solicitudes-core";
import { getRecibosDeSolicitud } from "./recibos-de-solicitud";

test("selects only exact receipt categories of the current request, preserving list order", () => {
  const item = (
    id: string,
    extra: Partial<SolicitudCoreAdjuntoResponse> = {},
  ) =>
    ({
      id,
      solicitudId: "a",
      tipoAdjunto: "Recibo de Sueldo",
      deletedAt: null,
      archivoNombre: "recibo.pdf",
      ...extra,
    }) as SolicitudCoreAdjuntoResponse;
  const list = [
    item("second"),
    item("other", { solicitudId: "b" }),
    item("name-only", { tipoAdjunto: "DNI" }),
    item("case", { tipoAdjunto: "Recibo de sueldo" }),
    item("deleted", { deletedAt: "2026-10-12" }),
    item("first"),
  ];
  assert.deepEqual(
    getRecibosDeSolicitud(list, "a").map((item) => item.id),
    ["second", "first"],
  );
  assert.deepEqual(getRecibosDeSolicitud(list, "missing"), []);
});
