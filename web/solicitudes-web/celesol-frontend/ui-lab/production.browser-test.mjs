import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
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
const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const outputDir =
  process.env.UI_LAB_OUTPUT_DIR ??
  path.join(frontendRoot, ".local/ui-production-review");
assert.ok(path.isAbsolute(outputDir), "UI_LAB_OUTPUT_DIR must be absolute.");
const allCases = [
  {
    id: "riesgo-desktop",
    role: "riesgo",
    viewport: { width: 1365, height: 699 },
  },
  {
    id: "riesgo-notebook",
    role: "riesgo",
    viewport: { width: 1024, height: 768 },
  },
  {
    id: "riesgo-short",
    role: "riesgo",
    viewport: { width: 1365, height: 480 },
    payment: "external",
  },
  {
    id: "riesgo-mobile",
    role: "riesgo",
    viewport: { width: 390, height: 844 },
  },
  {
    id: "vendedor-desktop",
    role: "vendedor",
    viewport: { width: 1365, height: 699 },
  },
  {
    id: "vendedor-mobile",
    role: "vendedor",
    viewport: { width: 390, height: 844 },
  },
  {
    id: "admin-desktop",
    role: "admin",
    viewport: { width: 1365, height: 699 },
  },
  {
    id: "riesgo-small-mobile",
    role: "riesgo",
    viewport: { width: 320, height: 568 },
  },
  {
    id: "riesgo-edit-mobile",
    role: "riesgo",
    viewport: { width: 390, height: 844 },
    edit: true,
  },
];
const cases = allCases.filter(
  (item) =>
    !process.env.UI_LAB_CASE_FILTER ||
    item.id.includes(process.env.UI_LAB_CASE_FILTER),
);
assert.ok(cases.length, "UI_LAB_CASE_FILTER did not match any case.");
const report = { baseUrl: base.origin, cases: [], failures: [] };

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}

async function ready(page) {
  await page.locator("article[data-header-expanded]").waitFor();
  await page.getByTestId("solicitud-reading-area").waitFor();
  await page
    .getByRole("heading", { name: "MARÍA EJEMPLO", exact: true })
    .waitFor();
  await page.getByText("Es socio", { exact: true }).first().waitFor();
  await settle(page);
}

async function closeDesktopSidebar(page, viewport) {
  if (
    viewport.width >= 768 &&
    (await page.locator('aside[aria-hidden="false"]').count())
  ) {
    await page
      .getByRole("button", {
        name: "Mostrar u ocultar menú lateral",
        exact: true,
      })
      .click();
    // A zero-width bordered sidebar can still occupy one CSS pixel.
    await page.waitForFunction(
      () => document.querySelector("aside").getBoundingClientRect().width <= 2,
    );
    await settle(page);
  }
}

async function measure(page) {
  return page.getByTestId("solicitud-reading-area").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const article = element.closest("article");
    const rounded = (value) => Math.round(value * 10) / 10;
    return {
      readingTop: rounded(rect.top),
      readingHeight: rounded(rect.height),
      visibleHeight: rounded(
        Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(0, rect.top)),
      ),
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      horizontalOverflow: Math.max(
        0,
        document.documentElement.scrollWidth - innerWidth,
      ),
      articleHorizontalOverflow: Math.max(
        0,
        article.scrollWidth - article.clientWidth,
      ),
      topbarHeight: rounded(
        document.querySelector(".app-topbar").getBoundingClientRect().height,
      ),
    };
  });
}

async function capture(page, name, result) {
  await settle(page);
  await page.screenshot({
    path: path.join(outputDir, `${name}.png`),
  });
  result.screenshots.push(`${name}.png`);
}

async function checkHeader(page, expanded) {
  const article = page.locator("article[data-header-expanded]");
  assert.equal(
    await article.getAttribute("data-header-expanded"),
    String(expanded),
  );
  const toggle = page.getByRole("button", {
    name: expanded ? "Ocultar encabezado" : "Mostrar encabezado",
    exact: true,
  });
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute("aria-expanded"), String(expanded));
  assert.equal(
    await toggle.getAttribute("aria-controls"),
    "solicitud-encabezado-completo",
  );
  const summary = page.locator(
    'section[aria-label="Datos rápidos del solicitante"]',
  );
  assert.ok((await summary.innerText()).includes("MARÍA EJEMPLO"));
  assert.ok((await summary.innerText()).includes("00000001"));
  await page.getByRole("button", { name: "Simulador", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Adjuntos (6)", exact: true })
    .waitFor();
}

async function toggleTwice(page) {
  await page
    .getByRole("button", { name: "Mostrar encabezado", exact: true })
    .click();
  await checkHeader(page, true);
  const calculator = page.locator(".calculadora-riesgo-univer");
  if (await calculator.count()) {
    await settle(page);
    const box = await calculator.boundingBox();
    assert.ok(
      box && box.height > 0 && box.width > 0,
      "Expanded header must not squash the real calculator to zero size.",
    );
    await calculator.scrollIntoViewIfNeeded();
  } else if (await page.getByText("Sin alertas.", { exact: true }).count()) {
    await page
      .getByText("Sin alertas.", { exact: true })
      .scrollIntoViewIfNeeded();
  }
  await page
    .getByRole("button", { name: "Ocultar encabezado", exact: true })
    .click();
  await checkHeader(page, false);
}

async function checkScroll(page) {
  const reading = page.getByTestId("solicitud-reading-area");
  await reading.scrollIntoViewIfNeeded();
  await reading.focus();
  // Wheel input tests the real scrolling element instead of rewriting its DOM.
  const box = await reading.boundingBox();
  await page.mouse.move(
    box.x + box.width / 2,
    Math.min(box.y + 30, page.viewportSize().height - 20),
  );
  await page.mouse.wheel(0, 650);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="solicitud-reading-area"]')
        .scrollTop > 0,
  );
}

async function exercise(page, item, result) {
  await checkHeader(page, false);
  // The compact header must retain the account number from dev. Loan controls
  // moved into the scrolling body in main and must not be duplicated above it.
  const linkedLoanText = /Préstamo 999001 vigente por/;
  assert.equal(await page.getByText(linkedLoanText).count(), 1);
  assert.equal(
    await page
      .locator("#solicitud-encabezado-completo")
      .getByText(linkedLoanText)
      .count(),
    0,
  );
  if (item.role === "vendedor") {
    assert.equal(
      await page.getByText("DEMO-100241", { exact: true }).count(),
      0,
    );
  } else {
    await page.getByText("DEMO-100241", { exact: true }).waitFor();
  }
  result.compact = await measure(page);
  assert.equal(
    result.compact.topbarHeight,
    item.viewport.width < 768 ? 48 : 40,
  );
  assert.equal(result.compact.horizontalOverflow, 0);
  assert.equal(result.compact.articleHorizontalOverflow, 0);
  assert.ok(
    result.compact.visibleHeight > 0,
    "The real detail body must remain visible.",
  );
  await capture(page, `${item.id}-compact`, result);

  await page
    .getByRole("button", { name: "Mostrar encabezado", exact: true })
    .click();
  await checkHeader(page, true);
  result.expanded = await measure(page);
  const summary = page.locator(
    'section[aria-label="Datos rápidos del solicitante"]',
  );
  await summary.getByText("CUIT", { exact: true }).waitFor();
  await summary
    .getByText("CONVENIO DE EJEMPLO · HABERES", { exact: true })
    .waitFor();
  await capture(page, `${item.id}-expanded`, result);
  await checkScroll(page);

  await page.reload({ waitUntil: "networkidle" });
  await ready(page);
  await closeDesktopSidebar(page, item.viewport);
  await checkHeader(page, true);
  await page
    .getByRole("button", { name: "Ocultar encabezado", exact: true })
    .click();
  await page.reload({ waitUntil: "networkidle" });
  await ready(page);
  await closeDesktopSidebar(page, item.viewport);
  await checkHeader(page, false);
  result.preferenceReload = "expanded and compact persisted";

  if (item.role === "vendedor") {
    assert.equal(
      await page
        .getByRole("button", { name: "Evaluación", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: "CredixSA", exact: true }).count(),
      0,
    );
  } else {
    await page.getByRole("button", { name: "CredixSA", exact: true }).click();
    await page
      .getByRole("heading", { name: "Datos filiatorios", exact: true })
      .waitFor();
    await toggleTwice(page);
    await capture(page, `${item.id}-credixsa`, result);
    await page.getByRole("button", { name: "Evaluación", exact: true }).click();
    await page
      .locator(".calculadora-riesgo-univer canvas:visible")
      .first()
      .waitFor({ timeout: 45000 });
    await page.getByText("Nivel de riesgo: 2", { exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        !document.body.textContent.includes(
          "Cargando datos de la solicitud...",
        ),
      { timeout: 30000 },
    );
    await toggleTwice(page);
    await capture(page, `${item.id}-evaluacion`, result);
    await page.getByRole("button", { name: "Solicitud", exact: true }).click();
    await ready(page);
  }
  await checkHeader(page, false);
  await checkScroll(page);
  if (item.edit) {
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await page.getByRole("button", { name: "Cancelar", exact: true }).waitFor();
    await page.getByRole("button", { name: "Guardar", exact: true }).waitFor();
    await toggleTwice(page);
    const saveChanges = page.getByRole("button", {
      name: "Guardar cambios",
      exact: true,
    });
    await saveChanges.scrollIntoViewIfNeeded();
    assert.equal(await saveChanges.isVisible(), true);
    await capture(page, `${item.id}-editing`, result);
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByRole("button", { name: "Editar", exact: true }).waitFor();
    result.editing =
      "save/cancel remained accessible through header toggles; cancelled without writes";
  }
  result.scroll = "real body scroll passed expanded and compact";
}

async function main() {
  const response = await fetch(new URL("/production", base), {
    signal: AbortSignal.timeout(5000),
  });
  assert.ok(
    response.ok && (await response.text()).includes("Beex UI Lab"),
    "Start npm run ui:dev first.",
  );
  await mkdir(outputDir, { recursive: true });
  const channel = process.env.UI_LAB_BROWSER_CHANNEL;
  const browser = await chromium.launch({
    headless: true,
    ...(channel ? { channel } : {}),
  });
  try {
    for (const item of cases) {
      const result = { ...item, screenshots: [], errors: [] };
      report.cases.push(result);
      const mobile = item.viewport.width < 768;
      const context = await browser.newContext({
        viewport: item.viewport,
        deviceScaleFactor: 1,
        locale: "es-AR",
        timezoneId: "America/Argentina/Buenos_Aires",
        colorScheme: "light",
        reducedMotion: "reduce",
        hasTouch: mobile,
        isMobile: mobile,
        serviceWorkers: "block",
      });
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (
          ["http:", "https:"].includes(url.protocol) &&
          url.origin !== base.origin
        ) {
          result.errors.push(`External request: ${url.origin}${url.pathname}`);
          await route.abort("blockedbyclient");
        } else await route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on("console", (message) => {
        if (message.type() === "error") result.errors.push(message.text());
      });
      page.on("pageerror", (error) => result.errors.push(error.message));
      try {
        const url = new URL("/production", base);
        url.searchParams.set("role", item.role);
        if (item.payment) url.searchParams.set("payment", item.payment);
        if (item.edit) url.searchParams.set("edit", "1");
        await page.goto(url.href, { waitUntil: "networkidle" });
        await ready(page);
        await closeDesktopSidebar(page, item.viewport);
        await exercise(page, item, result);
        assert.equal(
          result.errors.length,
          0,
          `Browser errors or external requests were observed (${result.errors.length}): ${result.errors.slice(0, 3).join(" | ")}`,
        );
        result.status = "passed";
        console.log(
          `PASS ${item.id}: ${result.compact.readingHeight}px reading, topbar ${result.compact.topbarHeight}px`,
        );
      } catch (error) {
        result.status = "failed";
        result.error = error.message;
        report.failures.push(`${item.id}: ${error.message}`);
        await capture(page, `${item.id}-failure`, result).catch(
          () => undefined,
        );
        console.error(`FAIL ${item.id}: ${error.message}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await writeFile(
      path.join(outputDir, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  console.log(
    `${report.cases.length - report.failures.length}/${report.cases.length} production cases passed. Evidence: ${outputDir}`,
  );
  if (report.failures.length) process.exitCode = 1;
}
await main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
