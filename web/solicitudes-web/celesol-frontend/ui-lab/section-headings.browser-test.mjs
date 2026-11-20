import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const base = new URL(process.env.UI_LAB_BASE_URL ?? "http://127.0.0.1:5271");
assert.ok(
  base.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) &&
    !base.username &&
    !base.password,
  "Run the test against the local UI Lab.",
);
const output =
  process.env.UI_LAB_OUTPUT_DIR ??
  path.resolve(".local/section-headings-review");
await mkdir(output, { recursive: true });

function heading(page, name) {
  return page.getByRole("heading", { name, exact: true });
}

async function checkStrip(element, background) {
  await element.waitFor();
  assert.equal(
    await element.evaluate((el) => getComputedStyle(el).backgroundColor),
    background,
  );
}

async function capture(page, file, element) {
  await page.evaluate(() => document.fonts.ready);
  if (element) await element.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(output, file + ".png"),
    animations: "disabled",
  });
}

async function openDetail(page, cutoff, role = "riesgo") {
  await page.goto(
    new URL(
      `/production?state=revision-riesgo&cutoff=${cutoff}&role=${role}`,
      base,
    ).href,
  );
  await page.getByText("AMEJUCA ESPECIAL", { exact: true }).waitFor();
}

const browser = await chromium.launch({
  channel: process.env.UI_LAB_BROWSER_CHANNEL ?? "chrome",
  headless: true,
});
try {
  for (const viewport of [
    { width: 1365, height: 860 },
    { width: 390, height: 844 },
  ]) {
    const mobile = viewport.width < 768;
    const label = mobile ? "movil" : "escritorio";
    const context = await browser.newContext({
      viewport,
      locale: "es-AR",
      timezoneId: "America/Argentina/Buenos_Aires",
      hasTouch: mobile,
      isMobile: mobile,
      serviceWorkers: "block",
      colorScheme: "light",
    });
    const errors = [];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === base.origin) return route.continue();
      errors.push(`External request: ${url.origin}`);
      await route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-11-20T15:30:00Z"));

    await openDetail(page, "confirmed");
    const navy = await page
      .locator(".app-topbar")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.equal(navy, "rgb(30, 45, 61)");
    const titular = heading(page, "Titular").locator("..");
    await checkStrip(titular, navy);
    const member = titular.getByText(/^Socio Nº/);
    await member.waitFor();
    assert.equal(
      await member.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(183, 240, 177)",
    );
    const loan = heading(page, "Préstamo");
    await checkStrip(loan.locator(".."), navy);
    const cutoff = page.getByRole("link", {
      name: "Modificar corte",
      exact: true,
    });
    await cutoff.waitFor();
    assert.equal(
      await cutoff.getAttribute("href"),
      "/solicitudes/fechas-de-corte",
    );
    await page.getByText("05/11/2026", { exact: true }).waitFor();
    assert.equal(
      await page.getByText("Corte del mes pendiente de confirmar").count(),
      0,
    );
    await capture(page, `${label}-solicitud`, mobile ? cutoff : undefined);

    const tabs = page.getByRole("tablist", { name: "Más información" });
    await checkStrip(tabs, navy);
    for (const name of [
      "Adjuntos",
      "Préstamos",
      "Solicitudes",
      "Refinanciación",
      "Cancelaciones",
    ]) {
      await tabs.getByRole("tab", { name, exact: true }).waitFor();
    }
    const attachments = tabs.getByRole("tab", {
      name: "Adjuntos",
      exact: true,
    });
    assert.equal(await attachments.getAttribute("aria-selected"), "true");
    assert.equal(
      await attachments.evaluate(
        (el) => getComputedStyle(el).borderBottomColor,
      ),
      "rgb(255, 255, 255)",
    );
    const loans = tabs.getByRole("tab", { name: "Préstamos", exact: true });
    await loans.press("Enter");
    assert.equal(await loans.getAttribute("aria-selected"), "true");
    if (mobile) await capture(page, "movil-pestanas", tabs);

    await page.getByRole("button", { name: "CredixSA", exact: true }).click();
    await checkStrip(heading(page, "Datos filiatorios").locator(".."), navy);
    const history = heading(page, "Deudas en el sistema financiero").locator(
      "../..",
    );
    await checkStrip(history.locator("header"), navy);
    await history.getByText("Fuente: BCRA", { exact: true }).waitFor();
    await history
      .getByRole("cell", { name: "N/D", exact: true })
      .first()
      .waitFor();
    await checkStrip(
      heading(page, "Deudas vigentes sistema financiero").locator(".."),
      navy,
    );
    await checkStrip(heading(page, "Quiebras").locator(".."), navy);
    const colors = await history
      .getByRole("row", { name: /Cooperativa de ejemplo/ })
      .getByRole("cell")
      .evaluateAll((cells) =>
        cells.slice(0, 3).map((el) => getComputedStyle(el).backgroundColor),
      );
    assert.equal(
      new Set(colors).size,
      3,
      "BCRA classifications retain distinct colors",
    );
    if (mobile) {
      const scroller = history.locator("table").locator("..");
      assert.ok(
        await scroller.evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
          const scrolls = el.scrollLeft > 0;
          el.scrollLeft = 0;
          return scrolls;
        }),
        "The BCRA table scrolls inside the card",
      );
    }
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await capture(page, `${label}-credixsa`);
    const directories = page.getByRole("region", {
      name: "Padrones de empleados",
    });
    const directoryHeader = directories.locator("header");
    await checkStrip(directoryHeader, navy);
    await directoryHeader.getByText(/Documento consultado:/).waitFor();
    const refresh = directoryHeader.getByRole("button", {
      name: "Actualizar padrones",
    });
    await refresh.click();
    await directories.getByRole("heading", { name: /Educación/ }).waitFor();
    await capture(page, `${label}-padrones`, directoryHeader);
    await page.getByText("Ver secciones adicionales", { exact: true }).click();
    await heading(page, "Aportes").waitFor();

    await openDetail(page, "pending");
    await loan.waitFor();
    const pending = page.getByText("Corte del mes pendiente de confirmar", {
      exact: true,
    });
    await pending.waitFor();
    assert.equal(await cutoff.count(), 0);
    await page
      .getByRole("link", { name: "Configurar fecha de corte" })
      .waitFor();
    await capture(
      page,
      `${label}-corte-pendiente`,
      mobile ? pending : undefined,
    );

    if (mobile) {
      await page.goto(new URL("/production?edit=1", base).href);
      const edit = page.getByRole("button", { name: "Editar", exact: true });
      await edit.click();
      const cancel = page.getByRole("button", {
        name: "Cancelar",
        exact: true,
      });
      await cancel.waitFor();
      await page
        .getByRole("button", { name: "Guardar cambios", exact: true })
        .waitFor();
      await checkStrip(heading(page, "Titular").locator(".."), navy);
      await checkStrip(loan.locator(".."), navy);
      await cancel.click();
      await edit.waitFor();
    }

    await openDetail(page, "confirmed", "vendedor");
    await page.getByText("05/11/2026", { exact: true }).waitFor();
    assert.equal(await cutoff.count(), 0);
    assert.equal(
      await page.getByRole("button", { name: "CredixSA", exact: true }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${label}: Solicitud, CredixSA, Padrones y corte AMEJUCA`);
  }
} finally {
  await browser.close();
}
