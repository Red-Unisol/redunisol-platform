import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
const base = process.env.UI_LAB_BASE_URL ?? "http://127.0.0.1:5271";
const target = new URL(base);
if (!["127.0.0.1", "localhost"].includes(target.hostname))
  throw Error("UI checks require a loopback lab URL");
const output =
  process.env.UI_LAB_OUTPUT_DIR ??
  path.resolve(".local/amejuca-cutoffs-review");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.UI_LAB_BROWSER_CHANNEL ?? "chrome",
  headless: true,
  args: ["--lang=es-AR"],
});
const page = await browser.newPage({
  viewport: { width: 1365, height: 1024 },
  deviceScaleFactor: 1,
  locale: "es-AR",
  timezoneId: "America/Argentina/Buenos_Aires",
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const capture = (name) =>
  page.screenshot({ path: path.join(output, name + ".png"), fullPage: true });
try {
  await page.goto(base + "/cutoffs?scenario=pending");
  await page
    .locator("article")
    .getByRole("heading", { name: "Fechas de corte", exact: true })
    .waitFor();
  await page
    .getByText("Corte del mes pendiente de confirmar", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Guardar corte", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("link", { name: "Fechas de corte", exact: true })
      .count(),
    1,
  );
  await capture("01-pendiente");
  await page.locator('article section[role="status"]').screenshot({ path: path.join(output, "01-aviso-pendiente.png") });
  await page
    .getByLabel("Fecha de corte confirmada", { exact: true })
    .fill("2026-11-08");
  await page
    .getByLabel("Observación")
    .fill("Aviso de AMEJUCA recibido el 3 de noviembre. Datos de ejemplo.");
  await capture("02-configurar");
  await page.locator("article form").screenshot({ path: path.join(output, "02-formulario.png") });
  await page
    .getByRole("button", { name: "Guardar corte", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Corte confirmado: 08/11/2026", exact: true })
    .waitFor();
  await page.getByText("Corte cargado: 08/11/2026", { exact: true }).waitFor();
  await capture("03-confirmado");
  await page.locator('article section[role="status"]').screenshot({ path: path.join(output, "03-aviso-confirmado.png") });
  await page.getByRole("heading", { name: "Historial del período", exact: true }).locator("..").screenshot({ path: path.join(output, "03-historial.png") });
  await page.getByLabel("Período", { exact: true }).fill("2026-12");
  await page
    .getByText("Corte del mes pendiente de confirmar", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByLabel("Fecha de corte confirmada", { exact: true })
      .inputValue(),
    "",
  );
  await page.goto(base + "/cutoffs?scenario=error");
  await page
    .getByLabel("Fecha de corte confirmada", { exact: true })
    .fill("2026-11-08");
  await page.getByLabel("Observación").fill("Conservar el borrador.");
  await page
    .getByRole("button", { name: "Guardar corte", exact: true })
    .click();
  await page
    .getByText("No se pudo guardar. Volvé a intentar.", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByLabel("Fecha de corte confirmada", { exact: true })
      .inputValue(),
    "2026-11-08",
  );
  assert.equal(
    await page.getByLabel("Observación").inputValue(),
    "Conservar el borrador.",
  );
  await capture("04-error");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/cutoffs?scenario=pending");
  await page
    .locator("article")
    .getByRole("heading", { name: "Fechas de corte", exact: true })
    .waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page
    .getByLabel("Fecha de corte confirmada", { exact: true })
    .fill("2026-11-08");
  await page
    .getByRole("button", { name: "Guardar corte", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Corte confirmado: 08/11/2026", exact: true })
    .waitFor();
  await capture("05-movil");

  const variantHeading = "Disponibilidad de líneas AMEJUCA";
  assert.equal(await page.getByRole("heading", { name: variantHeading }).count(), 0);
  await page.setViewportSize({ width: 1365, height: 1024 });
  await page.goto(base + "/cutoffs?role=admin");
  const variantPanel = page.getByRole("region", { name: variantHeading });
  await variantPanel.getByRole("status").getByText("Variante activa: Celesol").waitFor();
  const celesol = variantPanel.getByRole("radio", { name: "Celesol", exact: true });
  const redUnisol = variantPanel.getByRole("radio", { name: "Red Unisol", exact: true });
  const saveVariant = variantPanel.getByRole("button", { name: "Guardar variante", exact: true });
  assert.equal(await saveVariant.isDisabled(), true);
  await redUnisol.check();
  assert.equal(await celesol.isChecked(), false);
  await saveVariant.click();
  await variantPanel.getByRole("status").getByText("Variante activa: Red Unisol").waitFor();
  await variantPanel.screenshot({ path: path.join(output, "06-variante-escritorio.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await celesol.check();
  await saveVariant.click();
  await variantPanel.getByRole("status").getByText("Variante activa: Celesol").waitFor();
  assert.equal(await redUnisol.isChecked(), false);
  assert.ok(await variantPanel.evaluate((panel) => panel.scrollWidth <= panel.clientWidth));
  await variantPanel.screenshot({ path: path.join(output, "07-variante-movil.png") });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        passed: true,
        states: [
          "pending",
          "editing",
          "confirmed",
          "other-month",
          "save-error",
          "mobile",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Monthly cutoff browser checks passed. Screenshots: " + output);
} finally {
  await browser.close();
}
