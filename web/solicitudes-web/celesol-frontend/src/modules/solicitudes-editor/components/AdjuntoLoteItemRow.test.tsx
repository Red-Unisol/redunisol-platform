import assert from "node:assert/strict";
import { it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdjuntoLoteItemRow } from "./AdjuntoLoteItemRow";

for (const estadoAnalisis of [
  "error",
  "error_credencial",
  "analizando",
  "limite_proveedor",
  "autenticacion_proveedor",
  "timeout_proveedor",
  "modelo_no_disponible",
  "respuesta_invalida",
  "conexion_proveedor",
  "servicio_proveedor",
] as const)
  it(`manual controls and the selected category stay available while ${estadoAnalisis}`, () => {
    const html = renderToStaticMarkup(
      createElement(AdjuntoLoteItemRow, {
        disabled: false,
        estadoAnalisis,
        item: {
          id: "one",
          file: new File(["fixture"], "recibo.png", { type: "image/png" }),
          tipoAdjunto: "CUPO",
        },
        tiposAdjunto: [{ label: "CUPO", value: "CUPO" }],
        onRemove: () => {},
        onTipoAdjuntoChange: () => {},
      }),
    );
    assert.ok(html.includes("CUPO"));
    assert.ok(html.includes('aria-label="Tipo de adjunto para recibo.png"'));
    assert.ok(!html.includes('disabled=""'));
    if (estadoAnalisis !== "analizando")
      assert.ok(html.includes("manualmente"));
  });
