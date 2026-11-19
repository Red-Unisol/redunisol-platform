import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const base = new URL(process.env.UI_LAB_BASE_URL ?? "http://127.0.0.1:5271");
assert.equal(base.protocol, "http:");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname));
const output = process.env.UI_LAB_OUTPUT_DIR ?? ".local/ui-internal-areas";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.UI_LAB_BROWSER_CHANNEL || undefined,
});
try {
  for (const width of [1365, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const open = async (query) => {
      await page.goto(new URL(`/production?${query}`, base).href);
    };
    for (const role of ["tesoreria-legajos", "analisis-legajos"]) {
      await open(`list=recientes&role=${role}`);
      const myAreas = page.getByRole("button", { name: "Mis áreas" });
      await myAreas.waitFor();
      assert.equal(await myAreas.getAttribute("aria-pressed"), "true");
      assert.equal(await page.getByText("500001", { exact: true }).count(), 1);
      await page
        .getByRole("button", { name: "Ver todas", exact: true })
        .click();
      assert.equal(await myAreas.getAttribute("aria-pressed"), "false");
      await myAreas.click();
      await page.screenshot({
        animations: "disabled",
        path: path.join(output, `${role}-recientes-${width}.png`),
      });
      const bell = page.getByRole("button", {
        name: "Notificaciones: 1 sin leer",
      });
      await bell.click();
      await page.getByText("Nueva firma para revisar").waitFor();
      await page.keyboard.press("Escape");
      if (width === 390)
        await page
          .getByRole("button", { name: "Mostrar u ocultar menú lateral" })
          .click();
      const nav = page.getByRole("navigation");
      assert.equal(
        await nav.getByText("Administración", { exact: true }).count(),
        0,
      );
      assert.equal(
        await nav.getByText("Calculadora Mutual", { exact: true }).count(),
        role === "analisis-legajos" ? 1 : 0,
      );
      await nav.getByRole("button", { name: "Legajos Digitales" }).click();
      await nav.getByRole("link", { name: "Bandeja de firmas" }).click();
      await page
        .getByRole("heading", { name: "Bandeja de Legajos Digitales" })
        .waitFor();
      await page.getByRole("button", { name: "Revisar firma" }).waitFor();
      await page.screenshot({
        animations: "disabled",
        path: path.join(output, `${role}-firmas-${width}.png`),
      });
    }
    await open("list=usuarios&role=admin&areas=edit");
    const row = page
      .getByRole("row")
      .filter({ hasText: "maria.perez@example.invalid" });
    await row.getByRole("button", { name: "Editar" }).click();
    const dialog = page.getByRole("dialog");
    const legajos = dialog.getByRole("checkbox", { name: "Legajos Digitales" });
    await legajos.waitFor();
    assert.equal(await legajos.isChecked(), true);
    assert.equal(
      await dialog.getByRole("checkbox", { name: "Tesorería" }).isChecked(),
      true,
    );
    assert.equal(
      await dialog
        .getByRole("checkbox", { name: "Ventas de ejemplo" })
        .isDisabled(),
      true,
    );
    await dialog.getByRole("checkbox", { name: "Análisis" }).check();
    await legajos.uncheck();
    await page.screenshot({
        animations: "disabled",
      path: path.join(output, `editar-areas-${width}.png`),
    });
    await dialog.getByRole("button", { name: "Guardar cambios" }).click();
    const cases = page.getByRole("region", {
      name: "Solicitudes pendientes de reasignación",
    });
    await cases.getByRole("link", { name: "Solicitud 500001" }).waitFor();
    assert.ok((await row.innerText()).includes("Análisis, Tesorería"));
    await page.screenshot({
        animations: "disabled",
      path: path.join(output, `reasignar-${width}.png`),
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await open("list=pendientes&role=admin&areas=edit");
    const pending = page.getByRole("row").filter({ hasText: "sin.nombre@example.invalid" });
    await pending.getByRole("checkbox", { name: "Tesorería" }).check();
    await pending.getByRole("checkbox", { name: "Legajos Digitales" }).check();
    assert.ok(await pending.getByRole("checkbox", { name: "Ventas de ejemplo" }).isDisabled());
    await pending.getByRole("button", { name: "Asignar áreas" }).click();
    await page.getByRole("heading", { name: "No hay usuarios pendientes" }).waitFor();
    await page.close();
    console.log(`Áreas internas verificadas a ${width}px`);
  }
} finally {
  await browser.close();
}
