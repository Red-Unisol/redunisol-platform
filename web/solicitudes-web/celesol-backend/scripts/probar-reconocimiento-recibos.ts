/** Prueba REAL y explícita contra Mistral. No carga adjuntos ni solicitudes. */
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { MistralReciboGateway } from "../src/modules/solicitudes-core/adjuntos/reconocimiento/infrastructure/MistralReciboGateway";
async function main() {
  const paths = process.argv.slice(2);
  if (paths.length !== 5)
    throw new Error("Indicá los cinco recibos originales como argumentos.");
  if (!process.env.MISTRAL_API_KEY?.trim())
    throw new Error("Falta MISTRAL_API_KEY en el entorno privado.");
  const files = await Promise.all(
    paths.map(async (path) => {
      const mime: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".pdf": "application/pdf",
        ".webp": "image/webp",
      };
      const mimeType = mime[extname(path).toLowerCase()];
      if (!mimeType) throw new Error("Formato de prueba no admitido.");
      return {
        fileName: basename(path),
        mimeType,
        size: (await stat(path)).size,
        buffer: await readFile(path),
      };
    }),
  );
  const model = process.env.MISTRAL_OCR_MODEL || "mistral-ocr-latest";
  const gateway = new MistralReciboGateway({
    apiKey: process.env.MISTRAL_API_KEY.trim(),
    model,
    timeoutMs: Number(process.env.MISTRAL_OCR_TIMEOUT_MS || 45000),
  });
  let failed = false;
  for (const file of files) {
    const result = await gateway.reconocer(file);
    console.log(
      JSON.stringify({
        archivo: file.fileName,
        modeloSolicitado: model,
        ...result,
      }),
    );
    if (result.resultado !== "recibo") failed = true;
  }
  if (failed) process.exitCode = 1;
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "No se pudo ejecutar la prueba",
  );
  process.exitCode = 1;
});
