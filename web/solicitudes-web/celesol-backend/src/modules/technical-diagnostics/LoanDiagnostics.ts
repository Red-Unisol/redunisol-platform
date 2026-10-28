import { Prisma, type PrismaClient } from "@prisma/client";

export type LoanDiagnosticContext = {
  operationId: string;
  solicitudId?: string;
  actorId?: string;
  realActorId?: string;
  operation: "loan_generation" | "loan_replacement" | "loan_recovery";
};
export type LoanDiagnosticEvent = {
  stage: string;
  callId?: string;
  elapsedMs?: number;
  data: unknown;
};
export type LoanDiagnosticWriter = (
  context: LoanDiagnosticContext, event: LoanDiagnosticEvent, required?: boolean,
) => Promise<void>;

const REDACTED = "[REDACTED]";
const secretName = "(?:authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|password|passwd|pwd|passphrase|(?:access|refresh|id)[-_]?token|token|(?:api|private)[-_]?key|client[-_]?secret|secret|connection(?:[-_]?string)?|database[-_]?url)";
// Prefixes such as DB_PASSWORD and X-Api-Key are credentials too. Keep the
// pattern bounded at identifier boundaries so large bodies scan in linear time.
const secretKey = new RegExp(`(?:^|[-_])${secretName}$`, "i");
const assignmentName = `(?<![a-z0-9_-])(["']?)((?:[a-z0-9]+[-_])*${secretName})\\1(\\s*[=:]\\s*)`;

/** Redact credentials inside raw JSON, headers, URLs, stack traces and error HTML.
 * Bodies are never truncated; JSON requiring redaction may be reserialized. */
export function redactDiagnosticText(text: string): string {
  // JSON error fields can themselves contain encoded JSON, including secret
  // objects. Only reserialize when redaction changes a value; ordinary wire
  // bodies retain their original whitespace and key order.
  if (/^\s*[[{]/.test(text)) {
    try {
      const parsed: unknown = JSON.parse(text);
      const sanitized = sanitizeLoanDiagnostic(parsed);
      if (JSON.stringify(parsed) !== JSON.stringify(sanitized)) return JSON.stringify(sanitized);
    } catch { /* Malformed/HTML responses are still captured and scrubbed below. */ }
  }
  return redactEncodedStrings(text)
    .replace(/-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END (?:[A-Z ]*PRIVATE KEY)-----/g, REDACTED)
    .replace(/(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, `$1${REDACTED}@`)
    .replace(new RegExp(`${assignmentName}("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')`, "gi"), `$1$2$1$3"${REDACTED}"`)
    .replace(/\b((?:proxy[-_]?authorization|authorization)\s*[=:]\s*)(?:Basic|Bearer)\s+[^\s,;<>"']+/gi, `$1${REDACTED}`)
    .replace(/^([ \t]*(?:cookie|set[-_]?cookie|authorization|proxy[-_]?authorization)\s*:\s*)[^\r\n]*/gim, `$1${REDACTED}`)
    .replace(new RegExp(`${assignmentName}[^,;\\r\\n&<>"'\\]\\}]+`, "gi"), `$1$2$1$3${REDACTED}`)
    .replace(/<input\b[^>]*>/gi, tag => /\bname\s*=\s*["']?(?:password|passwd|pwd|token|secret)\b/i.test(tag)
      ? tag.replace(/(\bvalue\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${REDACTED}"`) : tag)
    .replace(/\bBearer\s+[a-z0-9._~+/-]+=*/gi, `Bearer ${REDACTED}`);
}

/** Scan quoted tokens once instead of backtracking over large malformed bodies. */
function redactEncodedStrings(text: string): string {
  const parts: string[] = [];
  let copied = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"') continue;
    const start = i++;
    let escapedQuote = false;
    for (; i < text.length && text[i] !== '"'; i++) {
      if (text[i] === "\\") { escapedQuote ||= text[i + 1] === '"'; i++; }
    }
    if (i >= text.length) break;
    if (!escapedQuote) continue;
    const token = text.slice(start, i + 1);
    try {
      const decoded: string = JSON.parse(token);
      const sanitized = redactDiagnosticText(decoded);
      if (decoded !== sanitized) {
        parts.push(text.slice(copied, start), JSON.stringify(sanitized));
        copied = i + 1;
      }
    } catch { /* Non-JSON diagnostic text is handled by the assignment scrubber. */ }
  }
  return parts.length ? parts.join("") + text.slice(copied) : text;
}

/** Snapshot, never mutate the business request or the original Error. */
export function sanitizeLoanDiagnostic(value: unknown): Prisma.InputJsonValue {
  const active = new WeakSet<object>();
  function visit(input: unknown): Prisma.InputJsonValue | null {
    if (input === null || input === undefined) return null;
    if (typeof input === "string") return redactDiagnosticText(input);
    if (typeof input === "boolean") return input;
    if (typeof input === "number") return Number.isFinite(input) ? input : String(input);
    if (typeof input === "bigint") return input.toString();
    if (typeof input !== "object") return String(input);
    if (input instanceof Date) return Number.isFinite(input.getTime()) ? input.toISOString() : "Invalid Date";
    if (active.has(input)) return "[CIRCULAR]";
    active.add(input);
    try {
      if (Array.isArray(input)) return input.map(visit);
      const source: Record<string, unknown> = {};
      for (const key of Object.getOwnPropertyNames(input)) {
        try { source[key] = (input as Record<string, unknown>)[key]; }
        catch { source[key] = "[UNREADABLE]"; }
      }
      if (input instanceof Error)
        Object.assign(source, { name: input.name, message: input.message, stack: input.stack, cause: input.cause });
      const result: Record<string, Prisma.InputJsonValue | null> = {};
      for (const [key, item] of Object.entries(source))
        result[key] = secretKey.test(key) ? REDACTED : visit(item);
      return result;
    } finally { active.delete(input); }
  }
  return visit(value) ?? {};
}

/** Initial REQUEST must persist before the side effect. Later diagnostic failures
 * never mask a confirmed loan ID or trigger another remote creation. */
export function createLoanDiagnosticWriter(
  db: Pick<PrismaClient, "technicalDiagnosticEvent">,
  options: { timeoutMs?: number; fallback?: (event: unknown) => void } = {},
): LoanDiagnosticWriter {
  const timeoutMs = options.timeoutMs ?? 2000;
  const fallback = options.fallback ?? (event => console.error(JSON.stringify(event)));
  return async (context, event, required = false) => {
    const data = sanitizeLoanDiagnostic(event.data);
    const snapshot = {
      ...context, stage: event.stage, callId: event.callId, elapsedMs: event.elapsedMs, data,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        db.technicalDiagnosticEvent.create({ data: { ...snapshot } }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Technical diagnostic storage timeout")), timeoutMs);
        }),
      ]);
    } catch (error) {
      // Private runtime logs are a fallback during database failures. The event
      // is already sanitized and keeps the complete response and correlation.
      try { fallback({ event: "loan_diagnostic_storage_failed", ...snapshot, storageError: sanitizeLoanDiagnostic(error) }); }
      catch { /* A failing console/collector must not mask the known Core result. */ }
      if (required) throw new Error("No se pudo guardar el diagnóstico técnico antes de contactar Vimarx.", { cause: error });
    } finally { if (timer) clearTimeout(timer); }
  };
}
