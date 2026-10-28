import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Start `npm run ui:dev` separately. This runner never starts or stops servers.
const base = new URL(process.env.UI_LAB_BASE_URL ?? "http://127.0.0.1:5271/");
assert.ok(
  base.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) &&
    !base.username &&
    !base.password &&
    base.pathname === "/" &&
    !base.search &&
    !base.hash,
  "UI_LAB_BASE_URL must be a loopback HTTP origin, without credentials or a path.",
);
const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const requestedOutput = process.env.UI_LAB_OUTPUT_DIR;
assert.ok(
  !requestedOutput || path.isAbsolute(requestedOutput),
  "UI_LAB_OUTPUT_DIR must be an absolute path when provided.",
);
const outputDir =
  requestedOutput ?? path.join(frontendRoot, ".local/ui-header-review");
const viewports = [
  { width: 1365, height: 699 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];
const designs = ["current", "slim", "merged", "focus"];
const report = { baseUrl: base.origin, cases: [], failures: [] };

async function ready(page) {
  await page
    .getByRole("heading", {
      name: "Revisión de firma y legajo digital",
      exact: true,
    })
    .waitFor();
  await page.waitForFunction(() => {
    const details = document.getElementById("header-demo-details");
    return (
      details?.textContent.includes("CONVENIO DE EJEMPLO") &&
      details.textContent.includes("Es socio") &&
      !details.textContent.includes("Consultando")
    );
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}

async function metrics(page) {
  return page.getByTestId("reading-area").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const product = document.querySelector('[data-testid="header-product"]');
    const productRect = product.getBoundingClientRect();
    const rounded = (value) => Math.round(value * 10) / 10;
    return {
      top: rounded(rect.top),
      height: rounded(rect.height),
      width: rounded(rect.width),
      visibleHeight: rounded(
        Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(0, rect.top)),
      ),
      contentHeight: element.scrollHeight,
      pageHorizontalOverflow: Math.max(
        0,
        document.documentElement.scrollWidth - innerWidth,
      ),
      productHorizontalOverflow: Math.max(
        0,
        product.scrollWidth - product.clientWidth,
      ),
      productHeight: rounded(productRect.height),
    };
  });
}

async function capture(page, filename) {
  await page.screenshot({
    path: path.join(outputDir, filename),
  });
  return filename;
}

async function selected(page, value) {
  const tab = page.locator(`#header-tab-${value}`);
  assert.equal(await tab.getAttribute("aria-selected"), "true");
  assert.equal(await tab.getAttribute("tabindex"), "0");
  assert.equal(
    await page.getByRole("tabpanel").getAttribute("aria-labelledby"),
    `header-tab-${value}`,
  );
}

async function exercise(page, design, stem, result) {
  if (design !== "current") {
    const toggle = page.getByRole("button", {
      name: "Mostrar encabezado",
      exact: true,
    });
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(
      await toggle.getAttribute("aria-controls"),
      "header-demo-details",
    );
    await toggle.click();
    await page
      .getByRole("button", { name: "Ocultar encabezado", exact: true })
      .waitFor();
    assert.equal(await page.locator("#header-demo-details").isVisible(), true);
    result.expanded = await metrics(page);
    result.expandedScreenshot = await capture(page, `${stem}-expanded.png`);
    await page
      .getByRole("button", { name: "Ocultar encabezado", exact: true })
      .click();
    assert.equal(await page.locator("#header-demo-details").isVisible(), false);
  }

  for (const [value, label, heading] of [
    ["evaluacion", "Evaluación", "Evaluación de la solicitud"],
    ["credixsa", "CredixSA", "Informe CredixSA"],
    ["solicitud", "Solicitud", "Revisión de firma y legajo digital"],
  ]) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    await selected(page, value);
  }

  await page.locator("#header-tab-solicitud").focus();
  for (const [key, value] of [
    ["ArrowRight", "evaluacion"],
    ["End", "credixsa"],
    ["Home", "solicitud"],
    ["ArrowLeft", "credixsa"],
    ["Home", "solicitud"],
  ]) {
    await page.keyboard.press(key);
    await selected(page, value);
    assert.equal(
      await page
        .locator(`#header-tab-${value}`)
        .evaluate((element) => element === document.activeElement),
      true,
    );
  }

  if (design === "focus") {
    const actions = page.getByRole("button", { name: "Acciones", exact: true });
    assert.equal(await page.locator("#header-demo-actions").isVisible(), false);
    await actions.click();
    assert.equal(await actions.getAttribute("aria-expanded"), "true");
    assert.equal(await page.locator("#header-demo-actions").isVisible(), true);
    result.actionsScreenshot = await capture(page, `${stem}-actions.png`);
    await actions.click();
    assert.equal(await page.locator("#header-demo-actions").isVisible(), false);
  }

  await page
    .getByRole("button", {
      name: "Mostrar u ocultar menú lateral",
      exact: true,
    })
    .click();
  const sidebar = page.locator(".header-sidebar");
  await sidebar.locator("aside").waitFor();
  await sidebar.getByRole("link", { name: "Históricas", exact: true }).click();
  await sidebar.waitFor({ state: "detached" });
  assert.equal(
    new URL(page.url()).pathname,
    "/headers",
    "Demo menu must not leave the gallery.",
  );

  await page.getByRole("button", { name: "Usuario", exact: true }).click();
  await page.getByText("SOFÍA DEMO", { exact: true }).waitFor();
  if (design === "current" || design === "slim") {
    await page.getByRole("button", { name: /Mis datos/ }).click();
    assert.equal(
      new URL(page.url()).pathname,
      "/headers",
      "Demo account must not leave the gallery.",
    );
  }
  await page.keyboard.press("Escape");
  result.interactions =
    "header, tabs, keyboard, actions, menu and account passed";
}

async function main() {
  const response = await fetch(new URL("/headers", base), {
    signal: AbortSignal.timeout(5000),
  });
  assert.ok(
    response.ok && (await response.text()).includes("Beex UI Lab"),
    "Start the isolated server with npm run ui:dev before ui:visual.",
  );
  await mkdir(outputDir, { recursive: true });
  const channel = process.env.UI_LAB_BROWSER_CHANNEL;
  const browser = await chromium.launch({
    headless: true,
    ...(channel ? { channel } : {}),
  });
  try {
    for (const viewport of viewports) {
      for (const design of designs) {
        const stem = `${viewport.width}x${viewport.height}-${design}`;
        const result = { design, viewport, screenshots: [], errors: [] };
        report.cases.push(result);
        const context = await browser.newContext({
          viewport,
          deviceScaleFactor: 1,
          locale: "es-AR",
          timezoneId: "America/Argentina/Buenos_Aires",
          colorScheme: "light",
          reducedMotion: "reduce",
          serviceWorkers: "block",
        });
        // Only browser resource requests are observed/guarded. Fixture fetch is
        // installed by the application itself and is neither mocked nor replaced.
        await context.route("**/*", async (route) => {
          const url = new URL(route.request().url());
          if (
            ["http:", "https:"].includes(url.protocol) &&
            url.origin !== base.origin
          ) {
            result.errors.push(
              `Unexpected network request: ${url.origin}${url.pathname}`,
            );
            await route.abort("blockedbyclient");
          } else await route.continue();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on("console", (message) => {
          if (message.type() === "error")
            result.errors.push(`Console: ${message.text()}`);
        });
        page.on("pageerror", (error) =>
          result.errors.push(`Uncaught: ${error.message}`),
        );
        page.on("websocket", (socket) => {
          const url = new URL(socket.url());
          url.protocol = url.protocol === "wss:" ? "https:" : "http:";
          if (url.origin !== base.origin)
            result.errors.push(`Unexpected websocket: ${socket.url()}`);
        });
        try {
          const url = new URL("/headers", base);
          url.search = new URLSearchParams({
            layout: design,
            clean: "1",
            embed: "1",
          }).toString();
          await page.goto(url.href, { waitUntil: "networkidle" });
          await ready(page);
          result.url = page.url();
          result.readingArea = await metrics(page);
          result.screenshots.push(await capture(page, `${stem}.png`));
          assert.equal(
            result.readingArea.pageHorizontalOverflow,
            0,
            "Page must fit the viewport horizontally.",
          );
          assert.equal(
            result.readingArea.productHorizontalOverflow,
            0,
            "Product must fit the viewport horizontally.",
          );
          assert.ok(
            result.readingArea.height > 0,
            "Reading area must have usable height.",
          );
          await exercise(page, design, stem, result);
          assert.deepEqual(
            result.errors,
            [],
            "Browser errors or external requests were observed.",
          );
          result.status = "passed";
          console.log(
            `PASS ${stem}: reading ${result.readingArea.height}px, top ${result.readingArea.top}px`,
          );
        } catch (error) {
          result.status = "failed";
          result.error = error.message;
          report.failures.push(`${stem}: ${error.message}`);
          result.screenshots.push(
            await capture(page, `${stem}-failure.png`).catch(
              () => "capture unavailable",
            ),
          );
          console.error(`FAIL ${stem}: ${error.message}`);
        } finally {
          await context.close();
        }
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
    `${report.cases.length - report.failures.length}/${report.cases.length} cases passed. Evidence: ${outputDir}`,
  );
  if (report.failures.length) process.exitCode = 1;
}

await main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
