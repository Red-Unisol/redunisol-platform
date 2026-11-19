import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const base = new URL(process.env.UI_LAB_BASE_URL ?? "http://127.0.0.1:5271");
assert(["127.0.0.1", "localhost"].includes(base.hostname));
const output = path.resolve(".local/loan-generation-review");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const errors = [],
  outbound = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (request) => {
  if (new URL(request.url()).origin !== base.origin)
    outbound.push(request.url());
});
try {
  for (const width of [1365, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const scenario of [
      "match",
      "safe",
      "uncertain",
      "ambiguous",
      "error",
      "stale",
    ]) {
      await page.goto(
        new URL(`/loan-generation?scenario=${scenario}`, base).href,
      );
      await page
        .getByRole("button", { name: "Volver a comprobar", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Consultando Vimarx…", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Volver a comprobar", exact: true })
        .waitFor();
      const action = page.getByRole("button", {
        name: scenario === "safe" ? "Liberar reserva" : "Recuperar préstamo",
        exact: true,
      });
      if (["match", "safe", "stale"].includes(scenario)) {
        await action.waitFor();
        assert(await action.isDisabled());
        await page
          .getByRole("textbox")
          .fill("Verificado el socio y las condiciones del intento");
        assert(await action.isEnabled());
      } else {
        assert.equal(
          await page
            .getByRole("button", {
              name: /^(Liberar reserva|Recuperar préstamo)$/,
            })
            .count(),
          0,
        );
      }
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: path.join(output, `${scenario}-${width}.png`),
        fullPage: true,
      });
      if (["match", "safe", "stale"].includes(scenario)) {
        await action.click();
        await page
          .getByText(
            scenario === "stale"
              ? "La reserva cambió. Actualizá la solicitud y volvé a comprobar."
              : "Comprobación aplicada. Solicitud actualizada.",
            { exact: true },
          )
          .waitFor();
      }
    }
    await page.goto(
      new URL("/loan-generation?scenario=match&role=riesgo", base).href,
    );
    await page
      .getByRole("button", { name: "Volver a comprobar", exact: true })
      .click();
    await page
      .getByText(
        "Encontramos un préstamo compatible en Vimarx. Un administrador puede comprobar sus datos y recuperar la vinculación.",
        { exact: true },
      )
      .waitFor();
    assert.equal(await page.getByRole("textbox").count(), 0);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(outbound, []);
  console.log(
    "OK: recheck, recovery, safe release, uncertain/ambiguous/error/stale results and role checks at desktop and 390px; no real API requests.",
  );
} finally {
  await browser.close();
}
