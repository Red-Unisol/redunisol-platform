import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const base = new URL(process.env.UI_LAB_BASE_URL || "http://127.0.0.1:5271");
assert.ok(base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname));
const output = process.env.UI_LAB_OUTPUT_DIR;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });

try {
  for (const width of [1365, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const button = (name) => page.getByRole("button", { name, exact: true });
    async function visit(query) {
      await page.goto(new URL(`/production?${query}`, base).href);
    }
    async function capture(name) {
      if (output) await page.screenshot({ path: path.join(output, `${name}-${width}.png`), animations: "disabled" });
    }

    for (const approved of [false, true]) {
      await visit("state=confirmada" + (approved ? "&signature=approved" : ""));
      await button("Enviar a liquidada").waitFor();
      if (!approved) {
        await capture("confirmada");
        await button("Enviar a liquidada").click();
        const handoff = page.getByRole("dialog");
        await handoff.getByRole("button", { name: "Enviar a liquidada" }).waitFor();
        await handoff.getByRole("button", { name: "Cancelar" }).click();
      }
      await button("Más acciones").click();
      assert.ok(await button("Devolver al vendedor").isVisible());
      const label = approved ? "Mandar a transferir" : "Enviar a firmar";
      await button(label).click();
      const dialog = page.getByRole("dialog");
      assert.match(await dialog.innerText(), /El análisis quedará terminado/);
      assert.equal(await dialog.getByRole("button", { name: label, exact: true }).count(), 1);
      await dialog.getByRole("button", { name: "Cancelar" }).click();
    }

    for (const mode of ["read", "edit-without-change", "edit", "cancel", "signed"]) {
      await visit("state=liquidada&role=vendedor" + (mode === "signed" ? "&signature=approved" : ""));
      await button("Finalizar revisión de datos").waitFor();
      if (mode !== "read" && mode !== "signed") {
        await button("Editar").click();
        assert.equal(await button("Guardar cambios").count(), 0);
        if (mode === "edit") {
          await button("Más acciones").click();
          assert.ok(await page.getByRole("button", { name: /^Desestimar/ }).isDisabled());
          await page.keyboard.press("Escape");
        }
        if (mode === "edit" || mode === "cancel") {
          await page.locator("textarea:visible:enabled").first().fill("Corrección de ejemplo.");
          if (mode === "cancel") await button("Cancelar").click();
        }
      } else if (mode === "read") {
        await capture("liquidada");
        await button("Más acciones").click();
        await button("Desestimar").click();
        const dismissal = page.getByRole("dialog");
        assert.ok(await dismissal.getByRole("button", { name: "Desestimar", exact: true }).isDisabled());
        await dismissal.getByRole("button", { name: "Cancelar", exact: true }).click();
      }
      await button("Finalizar revisión de datos").click();
      const dialog = page.getByRole("dialog");
      const description = await dialog.innerText();
      assert.doesNotMatch(description, /Destino|riesgo|transferir|firma/i);
      assert.equal(await dialog.locator("textarea").count(), 0);
      if (mode === "edit") await capture("finalizar-revision");
      await dialog.getByRole("button", { name: "Finalizar revisión de datos", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 5000 });
      const state = mode === "edit" ? "Revisión de Riesgo" : mode === "signed" ? "Transferir" : "Verificar firma y documentación";
      await page.getByText(state, { exact: true }).filter({ visible: true }).first().waitFor();
    }
    await visit("state=revision-riesgo&sellerChanges=1");
    const marks = page.getByText("Modificado por Vendedores", { exact: true });
    await marks.first().waitFor();
    assert.equal(await marks.count(), 2);
    for (const [field, before, after] of [
      ["celular", "011 5550 0100", "011 5550 0124"],
      ["observaciones", "Contactar por la mañana.", "El socio solicita el contacto por la tarde."],
    ]) {
      const previous = page.getByText("Antes: " + before, { exact: true });
      await previous.scrollIntoViewIfNeeded();
      assert.ok(await previous.isVisible());
      assert.ok(await page.getByText(after, { exact: true }).first().isVisible());
      await capture("riesgo-cambio-" + field);
    }
    await visit("state=revision-riesgo");
    await page.getByRole("heading", { name: "Titular", exact: true }).waitFor();
    assert.equal(await marks.count(), 0);
    await capture("riesgo-primera-recepcion");
    await page.close();
    console.log(`Revisión del vendedor, ${width}px: OK`);
  }
} finally {
  await browser.close();
}
