import assert from "node:assert/strict";
import { it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TipoAdjuntoSelect } from "./TipoAdjuntoSelect";

const options = ["DNI", "Recibo de Sueldo", "CUPO"].map((value) => ({
  label: value,
  value,
}));

it("shows a stored free-text category without changing its value", () => {
  const storedValue = "Recibo Haberes";
  let changes = 0;
  const html = renderToStaticMarkup(
    createElement(TipoAdjuntoSelect, {
      initialValue: storedValue,
      value: storedValue,
      options,
      onChange: () => changes++,
    }),
  );
  assert.ok(html.includes(storedValue));
  assert.ok(!html.includes("Seleccionar tipo"));
  assert.equal(changes, 0);
});

it("shows the stored category while the catalog is still loading", () => {
  const html = renderToStaticMarkup(
    createElement(TipoAdjuntoSelect, {
      initialValue: "Recibo Haberes",
      value: "Recibo Haberes",
      options: [],
      onChange: () => {},
    }),
  );
  assert.ok(html.includes("Recibo Haberes"));
  assert.ok(!html.includes("Seleccionar tipo"));
});

it("shows a manually chosen catalog category instead of the original one", () => {
  const html = renderToStaticMarkup(
    createElement(TipoAdjuntoSelect, {
      initialValue: "Recibo Haberes",
      value: "CUPO",
      options,
      onChange: () => {},
    }),
  );
  assert.ok(html.includes("CUPO"));
  assert.ok(!html.includes("Recibo Haberes"));
});
