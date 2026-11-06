import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = new URL(process.env.UI_LAB_BASE_URL ?? "http://127.0.0.1:5271/");
assert.ok(
  base.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) &&
    !base.username &&
    !base.password &&
    base.pathname === "/" &&
    !base.search &&
    !base.hash,
  "UI_LAB_BASE_URL must be a loopback HTTP origin.",
);
const outputDir =
  process.env.UI_LAB_OUTPUT_DIR ??
  fileURLToPath(new URL("../.local/ui-cuotas-review/", import.meta.url));
assert.ok(path.isAbsolute(outputDir), "UI_LAB_OUTPUT_DIR must be absolute.");
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.UI_LAB_BROWSER_CHANNEL
    ? { channel: process.env.UI_LAB_BROWSER_CHANNEL }
    : {}),
});
try {
  for (const viewport of [
    { width: 1365, height: 768 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      locale: "es-AR",
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    const errors = [];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (
        ["http:", "https:"].includes(url.protocol) &&
        url.origin !== base.origin
      ) {
        errors.push(`External request: ${url.origin}${url.pathname}`);
        await route.abort("blockedbyclient");
      } else await route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(new URL("/production?role=riesgo", base).href);
      await page.getByRole("tab", { name: "Préstamos", exact: true }).click();
      await page.getByText("DEMO-100241", { exact: true }).last().click();
      const plan = page.getByRole("table", {
        name: "Plan de cuotas y estado de cobro",
      });
      const cuotas = plan.locator("tbody tr[tabindex]");
      await cuotas.nth(0).press("Enter");
      const movimientos = page.getByRole("table", {
        name: "Movimientos de la cuota",
        exact: true,
      });
      const monto = movimientos
        .locator("tbody tr")
        .first()
        .locator("td")
        .nth(3);
      await monto.click({ modifiers: ["Control"] });
      assert.equal(
        await page.getByRole("status").innerText(),
        "1 celda · Suma\n$100",
      );
      // Keyboard activation has no pointerdown to clear the old selection.
      await page
        .getByRole("button", {
          name: "Cerrar movimientos de la cuota",
          exact: true,
        })
        .press("Enter");
      await movimientos.waitFor({ state: "hidden" });
      await cuotas.nth(1).press("Enter");
      await movimientos.waitFor();
      assert.equal(
        await page.getByRole("status").count(),
        0,
        "Opening another cuota must clear the old sum.",
      );
      assert.equal(
        await movimientos.locator('[aria-selected="true"]').count(),
        0,
      );
      await monto.click({ modifiers: ["Control"] });
      assert.equal(
        await page.getByRole("status").innerText(),
        "1 celda · Suma\n$200",
      );
      await page.screenshot({
        path: path.join(outputDir, `cuotas-${viewport.width}.png`),
      });
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("status").count(), 0);
      assert.equal(
        await movimientos.isVisible(),
        true,
        "The first Escape clears selection without closing the dialog.",
      );
      await page.keyboard.press("Escape");
      await movimientos.waitFor({ state: "hidden" });
      await cuotas.nth(1).press("Enter");
      await movimientos.waitFor();
      assert.equal(
        await page.getByRole("status").count(),
        0,
        "Reopening the same cuota must start without a sum.",
      );
      await page
        .getByRole("button", {
          name: "Cerrar movimientos de la cuota",
          exact: true,
        })
        .press("Enter");
      await movimientos.waitFor({ state: "hidden" });
      // The parent table still sums within one column and resets on another.
      await cuotas
        .nth(0)
        .locator("td")
        .nth(2)
        .click({ modifiers: ["Control"] });
      await cuotas
        .nth(1)
        .locator("td")
        .nth(2)
        .click({ modifiers: ["Control"] });
      assert.equal(
        await page.getByRole("status").innerText(),
        "2 celdas · Suma\n$300",
      );
      await cuotas
        .nth(0)
        .locator("td")
        .nth(5)
        .click({ modifiers: ["Control"] });
      assert.equal(
        await page.getByRole("status").innerText(),
        "1 celda · Suma\n$80",
      );
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("status").count(), 0);
      await cuotas.nth(0).dblclick();
      await movimientos.waitFor();
      await monto.click({ modifiers: ["Control"] });
      await monto.click();
      assert.equal(
        await page.getByRole("status").count(),
        0,
        "A plain click clears the sum.",
      );
      assert.deepEqual(errors, []);
      console.log(
        `PASS cuotas ${viewport.width}px: keyboard close/reopen, isolated sums, column change and Escape`,
      );
    } catch (error) {
      await page.screenshot({
        path: path.join(outputDir, `cuotas-${viewport.width}-failure.png`),
      });
      console.error(errors);
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
