import { z } from "zod";

// OCR es opcional; sus variables nunca deben impedir arrancar Solicitudes.
export const mistralEnvSchema = z.object({
  MISTRAL_API_KEY: z.string().trim().catch("").default(""),
  MISTRAL_OCR_MODEL: z
    .string()
    .trim()
    .min(1)
    .catch("mistral-ocr-latest")
    .default("mistral-ocr-latest"),
  MISTRAL_OCR_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(2_147_483_647)
    .catch(45000)
    .default(45000),
});
