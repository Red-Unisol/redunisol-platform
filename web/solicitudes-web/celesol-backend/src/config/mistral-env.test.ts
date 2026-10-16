import assert from "node:assert/strict";
import { it } from "node:test";
import { mistralEnvSchema } from "./mistral-env";

it("missing optional OCR configuration keeps safe startup defaults", () => {
  assert.deepEqual(mistralEnvSchema.parse({}), {
    MISTRAL_API_KEY: "",
    MISTRAL_OCR_MODEL: "mistral-ocr-latest",
    MISTRAL_OCR_TIMEOUT_MS: 45000,
  });
});
it("invalid optional OCR settings cannot prevent application startup", () => {
  for (const timeout of ["", "invalid", "0", "-1", "1.5", "4294967295"])
    assert.deepEqual(
      mistralEnvSchema.parse({
        MISTRAL_OCR_MODEL: "  ",
        MISTRAL_OCR_TIMEOUT_MS: timeout,
      }),
      {
        MISTRAL_API_KEY: "",
        MISTRAL_OCR_MODEL: "mistral-ocr-latest",
        MISTRAL_OCR_TIMEOUT_MS: 45000,
      },
    );
});
it("valid OCR settings are retained", () => {
  assert.deepEqual(
    mistralEnvSchema.parse({
      MISTRAL_API_KEY: " fixture-key ",
      MISTRAL_OCR_MODEL: " custom-ocr ",
      MISTRAL_OCR_TIMEOUT_MS: "5000",
    }),
    {
      MISTRAL_API_KEY: "fixture-key",
      MISTRAL_OCR_MODEL: "custom-ocr",
      MISTRAL_OCR_TIMEOUT_MS: 5000,
    },
  );
});
