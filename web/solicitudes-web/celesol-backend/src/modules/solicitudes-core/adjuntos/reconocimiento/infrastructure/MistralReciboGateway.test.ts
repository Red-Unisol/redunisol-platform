import { PDFDocument } from "pdf-lib";
import assert from "node:assert/strict";
import { it } from "node:test";
import { MistralReciboGateway } from "./MistralReciboGateway";
const file = {
  buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
  fileName: "sin-indicios.png",
  mimeType: "image/png",
  size: 9,
};
const annotation = {
  clasificacion: "recibo",
  periodo: true,
  agente: true,
  haberes: true,
  descuentos: true,
  neto: true,
};
function setup(
  value: unknown,
  options: {
    key?: string;
    status?: number;
    empty?: boolean;
    model?: string;
    timeout?: boolean;
  } = {},
) {
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  const gateway = new MistralReciboGateway({
    apiKey: options.key ?? "test-secret",
    model: "mistral-ocr-latest",
    timeoutMs: 10,
    fetch: (async (url, init) => {
      calls.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (String(url).endsWith("models"))
        return Response.json({
          data: [{ id: options.model ?? "mistral-ocr-latest" }],
        });
      if (options.timeout)
        return new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("timeout")),
          ),
        );
      return Response.json(
        {
          pages: [{ markdown: options.empty ? "" : "Contenido de documento" }],
          document_annotation:
            typeof value === "string" ? value : JSON.stringify(value),
        },
        { status: options.status ?? 200 },
      );
    }) as typeof fetch,
  });
  return { gateway, calls };
}
it("sends private bytes to actual OCR contract with structured document annotation, no filename rules", async () => {
  const { gateway, calls } = setup(annotation);
  assert.deepEqual(await gateway.reconocer(file), { resultado: "recibo" });
  assert.equal(calls[0].url, "https://api.mistral.ai/v1/models");
  const body = calls[1].body!;
  assert.deepEqual(body.document, {
    type: "image_url",
    image_url: "data:image/png;base64," + file.buffer.toString("base64"),
  });
  assert.equal(body.model, "mistral-ocr-latest");
  assert.equal(
    (body.document_annotation_format as { type: string }).type,
    "json_schema",
  );
  assert.ok(!JSON.stringify(body).includes(file.fileName));
  assert.ok(!JSON.stringify(body).includes("test-secret"));
});
it("PDF uses private base64 document_url", async () => {
  const { gateway, calls } = setup(annotation);
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  await gateway.reconocer({
    ...file,
    mimeType: "application/pdf",
    buffer: bytes,
    size: bytes.length,
    fileName: "test.pdf",
  });
  assert.equal(
    (calls[1].body?.document as { type: string }).type,
    "document_url",
  );
});
for (const result of ["no_recibo", "indeterminado"] as const)
  it(`distinguishes ${result}`, async () => {
    assert.equal(
      (
        await setup({ ...annotation, clasificacion: result }).gateway.reconocer(
          file,
        )
      ).resultado,
      result,
    );
  });
it("insufficient indicators cannot yield a positive classification", async () => {
  assert.equal(
    (await setup({ ...annotation, periodo: false }).gateway.reconocer(file))
      .resultado,
    "indeterminado",
  );
});
it("unreadable OCR is indeterminate even if annotation claims receipt", async () => {
  assert.equal(
    (await setup(annotation, { empty: true }).gateway.reconocer(file))
      .resultado,
    "indeterminado",
  );
});
it("missing key produces explicit error without a provider call", async () => {
  const { gateway, calls } = setup(annotation, { key: "" });
  assert.deepEqual(await gateway.reconocer(file), {
    resultado: "error",
    motivo: "credencial",
  });
  assert.equal(calls.length, 0);
});
it("unsupported formats preserve manual selection without OCR calls", async () => {
  const { gateway, calls } = setup(annotation);
  assert.deepEqual(
    await gateway.reconocer({ ...file, mimeType: "application/vnd.ms-excel" }),
    { resultado: "indeterminado", motivo: "formato" },
  );
  assert.equal(calls.length, 0);
});
it("unavailable model is an error before OCR", async () => {
  const { gateway, calls } = setup(annotation, { model: "other" });
  assert.equal((await gateway.reconocer(file)).resultado, "error");
  assert.equal(calls.length, 1);
});
it("malformed annotations and provider errors never become negatives", async () => {
  for (const data of [
    "not JSON",
    { ...annotation, confidence: 99 },
    { clasificacion: "recibo" },
  ])
    assert.equal(
      (await setup(data).gateway.reconocer(file)).resultado,
      "error",
    );
  assert.deepEqual(
    await setup(annotation, { status: 429 }).gateway.reconocer(file),
    {
      resultado: "error",
      motivo: "proveedor",
      codigoError: "limite_proveedor",
    },
  );
});
it("abort/timeout return sanitized errors", async () => {
  const { gateway } = setup(annotation, { timeout: true });
  const keepAlive = setTimeout(() => {}, 100);
  try {
    assert.equal((await gateway.reconocer(file)).resultado, "error");
  } finally {
    clearTimeout(keepAlive);
  }
});

it("checks the provider page restriction before OCR", async () => {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 1001; i++) pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  const { gateway, calls } = setup(annotation);
  assert.deepEqual(
    await gateway.reconocer({
      ...file,
      mimeType: "application/pdf",
      buffer: bytes,
      size: bytes.length,
    }),
    { resultado: "indeterminado", motivo: "formato" },
  );
  assert.equal(calls.length, 0);
});
it("corrupt/encrypted PDFs return a processing error, not a negative", async () => {
  const { gateway, calls } = setup(annotation);
  assert.deepEqual(
    await gateway.reconocer({
      ...file,
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-broken"),
    }),
    { resultado: "error", motivo: "procesamiento" },
  );
  assert.equal(calls.length, 0);
});

for (const status of [401, 403, 429, 500, 503])
  it(`HTTP ${status} preserves manual fallback, pauses calls and recovers later`, async () => {
    let now = 1000;
    let fail = true;
    let calls = 0;
    const gateway = new MistralReciboGateway({
      apiKey: "fixture-key",
      model: "mistral-ocr-latest",
      timeoutMs: 1000,
      now: () => now,
      fetch: (async (url) => {
        calls++;
        if (String(url).endsWith("models"))
          return Response.json({ data: [{ id: "mistral-ocr-latest" }] });
        if (fail)
          return Response.json({ error: "private-provider-body" }, { status });
        return Response.json({
          pages: [{ markdown: "Recibo" }],
          document_annotation: annotation,
        });
      }) as typeof fetch,
    });
    assert.deepEqual(await gateway.reconocer(file), {
      resultado: "error",
      motivo: "proveedor",
      codigoError:
        status === 429
          ? "limite_proveedor"
          : [401, 403].includes(status)
            ? "autenticacion_proveedor"
            : "servicio_proveedor",
    });
    const failedCalls = calls;
    assert.deepEqual(await gateway.reconocer(file), {
      resultado: "error",
      motivo: "proveedor",
      codigoError:
        status === 429
          ? "limite_proveedor"
          : [401, 403].includes(status)
            ? "autenticacion_proveedor"
            : "servicio_proveedor",
    });
    assert.equal(calls, failedCalls);
    fail = false;
    now += 30_000;
    assert.equal((await gateway.reconocer(file)).resultado, "recibo");
    assert.equal(calls, failedCalls + 1);
  });

it("network failure is contained and subsequent files fail fast", async () => {
  let calls = 0;
  const gateway = new MistralReciboGateway({
    apiKey: "fixture-key",
    model: "mistral-ocr-latest",
    timeoutMs: 1000,
    fetch: (async () => {
      calls++;
      throw new TypeError("private-network-error");
    }) as typeof fetch,
  });
  assert.deepEqual(await gateway.reconocer(file), {
    resultado: "error",
    motivo: "proveedor",
    codigoError: "conexion_proveedor",
  });
  assert.deepEqual(await gateway.reconocer(file), {
    resultado: "error",
    motivo: "proveedor",
    codigoError: "conexion_proveedor",
  });
  assert.equal(calls, 1);
});
it("manual cancellation does not pause a healthy provider", async () => {
  const { gateway, calls } = setup(annotation);
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (await gateway.reconocer(file, controller.signal)).resultado,
    "error",
  );
  assert.equal(calls.length, 0);
  assert.equal((await gateway.reconocer(file)).resultado, "recibo");
});

it("model and malformed response diagnostics never contain provider text", async () => {
  const model = await setup(annotation, { model: "other" }).gateway.reconocer(
    file,
  );
  assert.equal(model.codigoError, "modelo_no_disponible");
  const malformed = await setup("private-invalid-response").gateway.reconocer(
    file,
  );
  assert.equal(malformed.codigoError, "respuesta_invalida");
  assert.ok(!JSON.stringify(malformed).includes("private-invalid-response"));
});
it("timeout has a distinct safe diagnostic", async () => {
  const keepAlive = setTimeout(() => {}, 200);
  try {
    assert.equal(
      (await setup(annotation, { timeout: true }).gateway.reconocer(file))
        .codigoError,
      "timeout_proveedor",
    );
  } finally {
    clearTimeout(keepAlive);
  }
});
