import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = new URL(process.env.UI_LAB_BASE_URL ?? "http://127.0.0.1:5271/");
assert(
  ["127.0.0.1", "localhost"].includes(base.hostname) &&
    base.protocol === "http:",
);
const output = fileURLToPath(
  new URL("../.local/external-legajo-review", import.meta.url),
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
try {
  for (const width of [1365, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const scenario of ["waiting", "error"]) {
      await page.goto(`${base.origin}/external-legajo?scenario=${scenario}`);
      await page.getByRole("button", { name: "Usar legajo externo" }).click();
      const save = page.getByRole("button", {
        name: "Adjuntar y aprobar legajo externo",
      });
      assert(await save.isDisabled());
      await page.getByLabel("Archivos del legajo externo").setInputFiles({
        name: "foto-legajo.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhPQAAAAASUVORK5CYII=",
          "base64",
        ),
      });
      await page
        .getByLabel("Motivo para usar un legajo externo")
        .fill("PDF exportado o legajo físico revisado ante falta de conexión.");
      assert(await save.isDisabled());
      await page.getByRole("checkbox").check();
      await page.screenshot({
        path: path.join(output, `${scenario}-form-${width}.png`),
        fullPage: true,
      });
      assert(await save.isEnabled());
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await save.click();
      if (scenario === "error") {
        await page
          .getByRole("status")
          .filter({ hasText: "No se pudo guardar" })
          .waitFor();
        assert(await save.isEnabled());
        assert.equal(
          await page
            .getByLabel("Motivo para usar un legajo externo")
            .inputValue(),
          "PDF exportado o legajo físico revisado ante falta de conexión.",
        );
      } else {
        await page
          .getByRole("status")
          .filter({ hasText: "Legajo externo aprobado" })
          .waitFor();
        await page
          .getByRole("region", { name: "Seguimiento de firma" })
          .getByText("Legajo externo", { exact: true })
          .waitFor();
        assert.equal(
          await page.getByText("Sin firma", { exact: true }).count(),
          0,
        );
      }
      await page.screenshot({
        path: path.join(output, `${scenario}-result-${width}.png`),
        fullPage: true,
      });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "External legajo: desktop/mobile, zero attempts, required confirmation, success and recoverable storage error passed.",
  );
} finally {
  await browser.close();
}
