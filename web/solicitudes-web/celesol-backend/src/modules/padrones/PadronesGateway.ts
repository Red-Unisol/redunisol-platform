import { z } from "zod";

const timestamp = z
  .string()
  .max(64)
  .refine((v) => Number.isFinite(Date.parse(v)));
const sourceSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    kind: z.enum(["padron", "bajas"]),
    status: z.enum(["ready", "unpublished", "needs_review"]),
    period: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .nullable(),
    loaded_at: timestamp.nullable(),
    matches: z
      .array(
        z.object({
          row: z.number().int().positive(),
          data: z
            .record(z.string().max(500), z.string().max(20000))
            .refine((v) => Object.keys(v).length <= 60),
        }),
      )
      .max(500),
  })
  .refine((v) =>
    v.status === "ready"
      ? Boolean(v.period && v.loaded_at)
      : v.matches.length === 0,
  );
const reportSchema = z.object({
  document: z.string().regex(/^\d{6,8}$/),
  queried_at: timestamp,
  sources: z.array(sourceSchema).max(100),
});
export type PadronesReport = z.infer<typeof reportSchema>;

export function padronesDocument(
  value: string | null | undefined,
): string | null {
  if (!value || !/^[0-9 .-]+$/.test(value.trim())) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11) digits = digits.slice(2, 10);
  else if (![7, 8].includes(digits.length)) return null;
  digits = digits.replace(/^0+/, "");
  return digits.length >= 6 ? digits : null;
}

export class PadronesGateway {
  constructor(
    private config: { url: string; token: string; timeoutMs?: number },
    private request: typeof fetch = fetch,
  ) {}

  configured() {
    if (!this.config.url || this.config.token.length < 32) return false;
    try {
      const url = new URL(this.config.url);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }

  async lookup(document: string): Promise<PadronesReport> {
    if (!this.configured() || !/^\d{6,8}$/.test(document))
      throw new Error("Padrones no disponibles.");
    const response = await this.request(this.config.url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 5000),
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ document: document.padStart(7, "0") }),
    });
    const maxBytes = 2 * 1024 * 1024;
    if (
      !response.ok ||
      !response.body ||
      Number(response.headers.get("content-length")) > maxBytes
    )
      throw new Error("Padrones no disponibles.");
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes)
          throw new Error("Respuesta de padrones demasiado grande.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const result = reportSchema.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    if (result.document !== document)
      throw new Error("Los padrones corresponden a otro documento.");
    return result;
  }
}
