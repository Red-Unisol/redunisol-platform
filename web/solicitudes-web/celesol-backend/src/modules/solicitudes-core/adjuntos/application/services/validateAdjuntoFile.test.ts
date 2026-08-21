import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SolicitudAdjuntoUploadNotAllowedError } from "../../domain/solicitudes-adjuntos-errors";
import { validateAdjuntoFile } from "./validateAdjuntoFile";

const limits = {
  allowedExtensions: [".pdf"],
  allowedMimeTypes: ["application/pdf"],
  maxFileSizeBytes: 1024,
};

describe("validateAdjuntoFile", () => {
  it("does not throw for a file within the allowed extension, mime type, and size", () => {
    assert.doesNotThrow(() =>
      validateAdjuntoFile(
        { fileName: "dni.pdf", mimeType: "application/pdf", size: 512 },
        limits,
      ),
    );
  });

  it("rejects a disallowed extension", () => {
    assert.throws(
      () =>
        validateAdjuntoFile(
          { fileName: "dni.exe", mimeType: "application/pdf", size: 512 },
          limits,
        ),
      (error) => {
        assert.ok(error instanceof SolicitudAdjuntoUploadNotAllowedError);
        assert.equal(
          error.message,
          "La extensión del archivo no está permitida para adjuntos de la solicitud.",
        );
        return true;
      },
    );
  });

  it("rejects a disallowed mime type", () => {
    assert.throws(
      () =>
        validateAdjuntoFile(
          { fileName: "dni.pdf", mimeType: "application/x-msdownload", size: 512 },
          limits,
        ),
      (error) => {
        assert.ok(error instanceof SolicitudAdjuntoUploadNotAllowedError);
        assert.equal(
          error.message,
          "El tipo de archivo no está permitido para adjuntos de la solicitud.",
        );
        return true;
      },
    );
  });

  it("rejects a file exceeding the max size", () => {
    assert.throws(
      () =>
        validateAdjuntoFile(
          { fileName: "dni.pdf", mimeType: "application/pdf", size: 2048 },
          limits,
        ),
      (error) => {
        assert.ok(error instanceof SolicitudAdjuntoUploadNotAllowedError);
        assert.equal(
          error.message,
          "El archivo supera el tamaño máximo permitido para adjuntos de la solicitud.",
        );
        return true;
      },
    );
  });
});
