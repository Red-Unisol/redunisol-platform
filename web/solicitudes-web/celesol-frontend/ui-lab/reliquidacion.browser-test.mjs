import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const base = new URL(process.env.UI_LAB_BASE_URL ?? "http://127.0.0.1:5271");
assert(
  ["127.0.0.1", "localhost"].includes(base.hostname) &&
    base.protocol === "http:",
);
const output = path.resolve(".local/reliquidacion-review");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.emulateMedia({ reducedMotion: "reduce" });
const errors = [];
const outbound = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (request) => {
  if (new URL(request.url()).origin !== base.origin)
    outbound.push(request.url());
});
try {
  for (const width of [1365, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(new URL("/reliquidacion", base).href);
    await page
      .getByRole("button", { name: "Preparar reliquidación", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    const submit = dialog.getByRole("button", { name: "Pausar solicitud" });
    assert(await submit.isDisabled());
    await dialog
      .getByRole("textbox", { name: "Motivo obligatorio" })
      .fill("Corrección solicitada por el analista");
    assert(await submit.isEnabled());
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(output, `prepare-${width}.png`),
      fullPage: true,
    });
    await submit.click();
    await page
      .getByText("Solicitud pausada para reliquidación", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Verificar anulación y volver a Riesgo" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Verificar y devolver a Riesgo" })
      .click();
    await page.getByText("Reliquidación en Riesgo", { exact: true }).waitFor();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(output, `reopened-${width}.png`),
      fullPage: true,
    });
  }
  await page.goto(new URL("/reliquidacion?scenario=blocked", base).href);
  assert(
    await page
      .getByRole("button", { name: "Preparar reliquidación" })
      .isDisabled(),
  );
  await page.screenshot({
    path: path.join(output, "blocked-mobile.png"),
    fullPage: true,
  });
  await page.goto(new URL("/reliquidacion?scenario=error", base).href);
  await page.getByRole("button", { name: "Preparar reliquidación" }).click();
  await page.getByRole("textbox").fill("Corrección solicitada por el analista");
  await page.getByRole("button", { name: "Pausar solicitud" }).click();
  await page
    .getByRole("alert")
    .getByText(/Vimarx no respondió/)
    .waitFor();
  assert.equal(
    await page.getByRole("textbox").inputValue(),
    "Corrección solicitada por el analista",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(outbound, []);
  console.log(
    "Reliquidación: preparación, confirmación, bloqueo y error verificados en 1365, 390 y 320 px; sin solicitudes externas.",
  );
} finally {
  await browser.close();
}
