import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
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
);
const output = fileURLToPath(
  new URL("../.local/ui-cbu-review/", import.meta.url),
);
const habitual = "0110000699111100000248";
const other = "0200322911000015391276";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.UI_LAB_BROWSER_CHANNEL
    ? { channel: process.env.UI_LAB_BROWSER_CHANNEL }
    : {}),
});
const errors = [];
const context = await browser.newContext({
  viewport: { width: 1365, height: 900 },
  locale: "es-AR",
  reducedMotion: "reduce",
  serviceWorkers: "block",
});
await context.route("**/*", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (
    ["http:", "https:"].includes(url.protocol) &&
    (url.origin !== base.origin || request.method() !== "GET")
  ) {
    errors.push(
      `Solicitud inesperada: ${request.method()} ${url.origin}${url.pathname}`,
    );
    await route.abort();
  } else await route.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
const panel = page.getByRole("region", {
  name: "Comparación de CBU",
  exact: true,
});
async function open(scenario, edit = false) {
  await page.goto(
    new URL(`/production?cbu=${scenario}${edit ? "&edit=1" : ""}`, base).href,
    { waitUntil: "networkidle" },
  );
  await panel.waitFor();
  await panel.scrollIntoViewIfNeeded();
}
async function contains(text) {
  await panel.getByText(text, { exact: true }).first().waitFor();
}
try {
  for (const [scenario, text] of [
    ["match", "Coincide con el habitual de Vimarx"],
    ["different", "Difiere del habitual de Vimarx"],
    ["missing", "El socio no tiene un CBU habitual informado en Vimarx."],
    [
      "not_member",
      "No se encontró un socio con ese documento y tipo en Vimarx.",
    ],
    [
      "ambiguous",
      "Hay más de un socio con ese documento en Vimarx. Revisá su identidad para comparar el CBU.",
    ],
    [
      "unavailable",
      "No se pudo consultar el CBU habitual en Vimarx. Volvé a intentar.",
    ],
    ["invalid", "El CBU registrado en Vimarx requiere revisión de formato."],
    ["empty", "Sin cargar en la solicitud"],
  ]) {
    await open(scenario);
    await contains(text);
    if (
      ["missing", "not_member", "ambiguous", "unavailable"].includes(scenario)
    ) {
      await contains("Sin dato confirmado");
      assert.equal(
        await panel
          .getByText("Coincide con el habitual de Vimarx", { exact: true })
          .count(),
        0,
      );
    }
    console.log(`PASS ${scenario}`);
  }
  await open("refresh-error");
  await contains("Coincide con el habitual de Vimarx");
  await panel.getByRole("button", { name: "Actualizar CBU" }).click();
  await contains(
    "No se pudo consultar el CBU habitual en Vimarx. Volvé a intentar.",
  );
  await contains("Sin dato confirmado");
  assert.equal(
    await panel
      .getByText("Coincide con el habitual de Vimarx", { exact: true })
      .count(),
    0,
    "No conservar una coincidencia vieja tras un error",
  );
  await panel.getByRole("button", { name: "Actualizar CBU" }).click();
  await contains("Coincide con el habitual de Vimarx");
  console.log("PASS refresh-error and recovery");
  await open("match", true);
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  const input = page.getByLabel("CBU", { exact: true });
  await input.fill(other);
  await contains("Difiere del habitual de Vimarx");
  await page
    .getByLabel("Documento", { exact: false })
    .filter({ visible: true })
    .first()
    .fill("99111124");
  await contains(
    "Guardá el documento y el CUIT para consultar el CBU habitual del titular actualizado.",
  );
  await contains("Sin dato confirmado");
  assert.equal(
    await panel.getByRole("button", { name: "Actualizar CBU" }).isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await contains("Coincide con el habitual de Vimarx");
  console.log("PASS draft CBU and changed identity without writes");
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page
    .getByLabel(/^CUIT/)
    .filter({ visible: true })
    .first()
    .fill("20301112223");
  await contains(
    "Guardá el documento y el CUIT para consultar el CBU habitual del titular actualizado.",
  );
  await contains("Sin dato confirmado");
  assert.equal(
    await panel.getByRole("button", { name: "Actualizar CBU" }).isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await contains("Coincide con el habitual de Vimarx");
  console.log(
    "PASS changed CUIT suspends the previous bank identity without writes",
  );
  await mkdir(output, { recursive: true });
  for (const [name, viewport] of [
    ["desktop", { width: 1365, height: 900 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    await page.setViewportSize(viewport);
    await open("nonhabitual");
    await contains("Coincide con el habitual de Vimarx");
    await contains("Difiere del habitual de Vimarx");
    await contains(
      "La solicitud indica un CBU no habitual como destino de transferencia.",
    );
    assert.equal(await panel.getByText(habitual, { exact: true }).count(), 2);
    assert.equal(await panel.getByText(other, { exact: true }).count(), 1);
    const box = await panel.boundingBox();
    assert.ok(
      box && box.x >= 0 && box.x + box.width <= viewport.width + 1,
      "La comparación debe entrar en el viewport",
    );
    await panel.screenshot({ path: `${output}/${name}.png` });
    console.log(`PASS ${name} comparison and independent non-habitual CBU`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
