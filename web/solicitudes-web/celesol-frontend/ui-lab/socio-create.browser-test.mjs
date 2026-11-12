import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const base = new URL(process.env.UI_LAB_BASE_URL ?? "http://127.0.0.1:5271");
assert.ok(["127.0.0.1", "localhost"].includes(base.hostname));
const output = path.resolve(
  process.env.UI_LAB_OUTPUT_DIR ?? ".local/ui-socio-cbu-review",
);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.UI_LAB_BROWSER_CHANNEL ?? "chrome",
  headless: true,
});
const report = [];
try {
  for (const [name, viewport] of [
    ["desktop", { width: 1365, height: 900 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === base.origin ? route.continue() : route.abort();
    });
    await page.goto(new URL("/socio-create", base).href);
    await page
      .getByRole("button", { name: "Abrir alta de socio", exact: true })
      .click();
    const cbu = page.getByRole("textbox", { name: "CBU", exact: true });
    await cbu.waitFor();
    assert.equal(await cbu.inputValue(), "0110000699111100000248");
    const save = page.getByRole("button", { name: "Guardar", exact: true });
    await cbu.fill("0110000699111100000249");
    await cbu.press("Tab");
    await page
      .getByText("Ingresá un CBU válido de 22 dígitos.", { exact: true })
      .waitFor();
    assert.equal(await save.isEnabled(), false);
    await page.screenshot({ path: path.join(output, `${name}-invalid.png`) });
    await cbu.fill("0110000699111100000248");
    await cbu.press("Tab");
    await cbu.scrollIntoViewIfNeeded();
    assert.equal(await save.isEnabled(), true);
    assert.equal(await cbu.getAttribute("aria-invalid"), "false");
    await cbu.evaluate(async (element) => {
      await new Promise(requestAnimationFrame);
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished),
      );
    });
    await page.screenshot({ path: path.join(output, `${name}-prefilled.png`) });
    await save.click();
    const payload = page.getByTestId("saved-payload");
    await payload.waitFor();
    const saved = JSON.parse(await payload.innerText());
    assert.equal(saved.cbu, "0110000699111100000248");
    assert.equal("cbuNoHabitual" in saved, false);
    await page
      .getByRole("button", { name: "Abrir alta de socio", exact: true })
      .click();
    await cbu.fill("");
    await cbu.press("Tab");
    assert.equal(await save.isEnabled(), true);
    await save.click();
    assert.equal("cbu" in JSON.parse(await payload.innerText()), false);
    assert.deepEqual(errors, []);
    report.push({
      name,
      viewport,
      prefill: true,
      rejectsInvalidCbu: true,
      sendsTitularCbu: true,
      optionalCbu: true,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
await fs.writeFile(
  path.join(output, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log("Socio CBU browser checks passed: " + output);
