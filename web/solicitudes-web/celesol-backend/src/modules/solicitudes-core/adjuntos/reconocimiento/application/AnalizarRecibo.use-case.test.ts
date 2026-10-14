import assert from "node:assert/strict";
import { it } from "node:test";
import { AnalizarReciboUseCase } from "./AnalizarRecibo.use-case";
it("checks persisted configuration before the provider and after processing; disable/reactivate invalidates pending results", async () => {
  for (const change of ["none", "disabled", "reactivated", "initialDisabled"]) {
    let config = { habilitado: change !== "initialDisabled", version: 1 };
    let calls = 0;
    const uc = new AnalizarReciboUseCase({
      configuracion: { get: async () => config, update: async () => config },
      gateway: {
        reconocer: async () => {
          calls++;
          if (change !== "none")
            config = { habilitado: change === "reactivated", version: 2 };
          return { resultado: "recibo" };
        },
      },
      allowedExtensions: [".png"],
      allowedMimeTypes: ["image/png"],
      maxFileSizeBytes: 100,
    });
    const result = await uc.execute({
      fileName: "a.png",
      mimeType: "image/png",
      size: 8,
      buffer: Buffer.alloc(8),
    });
    assert.equal(calls, change === "initialDisabled" ? 0 : 1);
    assert.equal(
      result.resultado,
      change === "none" ? "recibo" : "deshabilitado",
    );
  }
});
it("validates upload limits before OCR, without persistent side effects", async () => {
  const uc = new AnalizarReciboUseCase({
    configuracion: {
      get: async () => ({ habilitado: true, version: 1 }),
      update: async () => {
        throw new Error("unexpected write");
      },
    },
    gateway: {
      reconocer: async () => {
        throw new Error("must not call");
      },
    },
    allowedExtensions: [".png"],
    allowedMimeTypes: ["image/png"],
    maxFileSizeBytes: 10,
  });
  await assert.rejects(
    uc.execute({
      fileName: "a.png",
      mimeType: "image/png",
      size: 11,
      buffer: Buffer.alloc(11),
    }),
    /tamaño máximo/,
  );
});

it("unexpected provider exceptions become optional analysis errors", async () => {
  const uc = new AnalizarReciboUseCase({
    configuracion: {
      get: async () => ({ habilitado: true, version: 1 }),
      update: async () => {
        throw new Error("must not change activation");
      },
    },
    gateway: {
      reconocer: async () => {
        throw new Error("private-provider-details");
      },
    },
    allowedExtensions: [".png"],
    allowedMimeTypes: ["image/png"],
    maxFileSizeBytes: 100,
  });
  assert.deepEqual(
    await uc.execute({
      fileName: "a.png",
      mimeType: "image/png",
      size: 8,
      buffer: Buffer.alloc(8),
    }),
    { resultado: "error", motivo: "proveedor", version: 1 },
  );
});
