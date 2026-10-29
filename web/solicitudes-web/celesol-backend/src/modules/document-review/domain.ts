import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

export const REVIEW_POLICY_VERSION = "beex-document-review/2";
export const REVIEW_STATE = "VerificarFirmaYDocumentacion";
export type Decision = "approve" | "not_approve";
export type JsonObject = Record<string, unknown>;
export type ReviewSource = {
  solicitudId: string;
  nroSolicitud: string | null;
  prestamoId: string | null;
  cycleId: string;
  signatureRequestedAt?: string;
  line: string;
  mutual: string | null;
  name: string;
  dni: string | null;
  amount: string | null;
  installments: number | null;
  installmentAmount: string | null;
  birthDate: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
};
export type Check = {
  code: string;
  label: string;
  passed: boolean;
  expected: string | null;
  actual: string | null;
  reason: string;
};
export type SignedDocument = {
  id: string;
  signer: string | null;
  readAt: string | null;
  signedAt: string | null;
  url: string | null;
  variables: { title: string; value: string | null }[];
};
export type ProviderCandidate = {
  verificationId: string;
  completedAt: string | null;
  originalStatus: string | null;
  dashboardUrl: string | null;
  resource: JsonObject | null;
  error: string | null;
};
export type Attempt = {
  verificationId: string;
  completedAt: string | null;
  providerStatus: string | null;
  originalStatus: string | null;
  dashboardUrl: string | null;
  decision: Decision;
  reasons: string[];
  checks: Check[];
  documents: SignedDocument[];
  evidenceAvailable: boolean;
  resourceFingerprint: string;
};
export type Assessment = {
  decision: Decision;
  reasons: string[];
  selectedVerificationId: string | null;
  attempts: Attempt[];
};
export class DocumentReviewError extends Error {
  constructor(
    message: string,
    public statusCode = 409,
  ) {
    super(message);
    this.name = "DocumentReviewError";
  }
}

export function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}
export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return value && typeof value === "object" ? text(object(value).value) : null;
}
export function label(value: unknown): string {
  return (text(value) ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
export function digest(value: unknown): string {
  function canonical(v: unknown): unknown {
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(object(v))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, w]) => [k, canonical(w)]),
      );
    return v;
  }
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function dni(value: unknown): string | null {
  const s = text(value);
  if (!s || !/^[\d.\s-]+$/.test(s)) return null;
  const n = s.replace(/[.\s-]/g, "");
  return /^\d{7,8}$/.test(n) ? n : null;
}

// BEEX stores amount as an ungrouped decimal, but cuotaResultante and the
// signed variables use Argentine formatting. Never compare floating points.
export function money(value: unknown, argentine = false): string | null {
  let s = text(value);
  if (!s) return null;
  if (/\$|ARS/i.test(s)) argentine = true;
  s = s.replace(/ARS/gi, "").replace(/\$/g, "").replace(/\s/g, "");
  if (s.includes(",")) argentine = true;
  if (argentine) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,4})?$/.test(s)) return null;
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (!/^\d+(?:\.\d{1,4})?$/.test(s)) return null;
  try {
    const n = new Prisma.Decimal(s);
    return n.greaterThan(0)
      ? n.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2)
      : null;
  } catch {
    return null;
  }
}
function count(value: unknown): string | null {
  const s = text(value);
  return s &&
    /^\d+$/.test(s) &&
    Number.isSafeInteger(Number(s)) &&
    Number(s) > 0
    ? String(Number(s))
    : null;
}

export function signedDocuments(resource: JsonObject): SignedDocument[] {
  const steps = array(resource.steps)
    .map(object)
    .filter((s) => s.id === "electronic-signature-document-validation");
  const details = steps.flatMap((s) =>
    array(object(s.data).signedDocumentDetails),
  );
  const docs = details
    .map(object)
    .map((d) => ({
      id: text(d.documentId) ?? "",
      signer: text(d.fullName),
      readAt: text(d.readAt),
      signedAt: text(d.signedAt),
      url: text(d.pdfDocumentUrl),
      variables: Object.values(object(d.customVariables))
        .map(object)
        .map((v) => ({ title: text(v.title) ?? "", value: text(v.value) })),
    }))
    .filter((d) => d.id);
  return docs;
}
export function declarations(resource: JsonObject) {
  return array(object(resource.customInputValues).fields)
    .map(object)
    .map((f) => ({
      name: text(f.name),
      title: text(f.label),
      value: object(f.atomicFieldParams).value,
    }));
}
function pep(resource: JsonObject): boolean | null {
  const fields = declarations(resource).filter((f) => {
    const s = label(`${f.name ?? ""} ${f.title ?? ""}`);
    return /\bpep\b/.test(s) || /expuest[ao]s? politic/.test(s);
  });
  if (!fields.length) return null;
  if (fields.some((f) => f.value === true || f.value === "true")) return true;
  return fields.every((f) => f.value === false || f.value === "false")
    ? false
    : null;
}
function variables(
  docs: SignedDocument[],
  titles: string[],
  normalize: (v: unknown) => string | null,
): string | null {
  const keys = titles.map(label);
  const values = docs
    .flatMap((d) => d.variables)
    .filter((v) => keys.includes(label(v.title)))
    .map((v) => normalize(v.value));
  return values.length && values.every((v) => v !== null && v === values[0])
    ? values[0]
    : null;
}
function compare(
  code: string,
  name: string,
  expected: string | null,
  actual: string | null,
): Check {
  const passed = expected !== null && actual !== null && expected === actual;
  return {
    code,
    label: name,
    passed,
    expected,
    actual,
    reason: passed
      ? `${name}: coincide.`
      : actual === null || expected === null
        ? `${name}: falta un valor inequívoco para comparar.`
        : `${name}: no coincide con la solicitud.`,
  };
}

export function assessAttempt(
  source: ReviewSource,
  candidate: ProviderCandidate,
): Attempt {
  const r = candidate.resource ?? {};
  const docs = signedDocuments(r);
  const nationalIds = array(r.documents)
    .map(object)
    .filter((d) => label(d.type) === "national id");
  const documentNumbers = nationalIds.map((d) =>
    dni(object(d.fields).documentNumber),
  );
  const actualDni =
    documentNumbers.length &&
    documentNumbers.every((v) => v !== null && v === documentNumbers[0])
      ? documentNumbers[0]
      : null;
  const currentStatus = text(object(r.identity).status);
  const pepValue = pep(r);
  const checks: Check[] = [
    {
      code: "cycle",
      label: "Firma del ciclo vigente",
      passed: !source.signatureRequestedAt || (docs.length > 0 && docs.every(d => d.signedAt && Number.isFinite(Date.parse(d.signedAt)) && Date.parse(d.signedAt) >= Date.parse(source.signatureRequestedAt!))),
      expected: source.signatureRequestedAt ?? "Ciclo inicial",
      actual: docs.map(d => d.signedAt).filter(Boolean).join(", ") || null,
      reason: "La firma debe ser posterior al pedido explícito de volver a firmar.",
    },
    compare(
      "operation",
      "Referencia de la operación",
      source.prestamoId,
      variables(docs, ["Solicitud"], text),
    ),
    compare("dni", "DNI", dni(source.dni), actualDni),
    compare(
      "amount",
      "Monto solicitado",
      money(source.amount),
      variables(docs, ["Importe solicitado", "Monto solicitado"], (v) =>
        money(v, true),
      ),
    ),
    compare(
      "installments",
      "Cantidad de cuotas",
      count(source.installments),
      variables(docs, ["Cuotas a pagar", "Cantidad de cuotas"], count),
    ),
    compare(
      "installmentAmount",
      "Importe de cuota",
      money(source.installmentAmount, true),
      variables(docs, ["Importe cuota", "Importe de cuota"], (v) =>
        money(v, true),
      ),
    ),
    {
      code: "pep",
      label: "Declaración PEP",
      passed: pepValue === false,
      expected: "No",
      actual: pepValue === null ? null : pepValue ? "Sí" : "No",
      reason:
        pepValue === false
          ? "PEP: no marcado."
          : pepValue
            ? "PEP: marcado; requiere revisión humana."
            : "PEP: declaración ausente o ambigua.",
    },
    {
      code: "metamap",
      label: "MetaMap en verde",
      passed: currentStatus === "verified",
      expected: "verified",
      actual: currentStatus,
      reason:
        currentStatus === "verified"
          ? "MetaMap: estado vigente verified (verde)."
          : `MetaMap: ${currentStatus ?? "no se pudo comprobar el estado vigente"}.`,
    },
  ];
  const signed =
    docs.length > 0 &&
    docs.every(
      (d) => d.url && d.signedAt && Number.isFinite(Date.parse(d.signedAt)),
    );
  const reasons = checks.filter((c) => !c.passed).map((c) => c.reason);
  if (candidate.error) reasons.unshift(candidate.error);
  if (!signed)
    reasons.push(
      "No están disponibles todos los originales firmados de este intento.",
    );
  return {
    verificationId: candidate.verificationId,
    completedAt: candidate.completedAt,
    providerStatus: currentStatus,
    originalStatus: candidate.originalStatus,
    dashboardUrl: candidate.dashboardUrl,
    decision: reasons.length ? "not_approve" : "approve",
    reasons: reasons.length
      ? reasons
      : ["Datos coincidentes, PEP no marcado y MetaMap en verde."],
    checks,
    documents: docs,
    evidenceAvailable: candidate.resource !== null && signed,
    resourceFingerprint: providerFingerprint([candidate]),
  };
}

export function assess(
  source: ReviewSource,
  candidates: ProviderCandidate[],
  discoveryError: string | null = null,
): Assessment {
  const unique = [
    ...new Map(candidates.map((c) => [c.verificationId, c])).values(),
  ];
  const attempts = unique
    .map((c) => assessAttempt(source, c))
    .sort(
      (a, b) =>
        (Date.parse(b.completedAt ?? "") || 0) -
          (Date.parse(a.completedAt ?? "") || 0) ||
        a.verificationId.localeCompare(b.verificationId),
    );
  const good = attempts.find((a) => a.decision === "approve");
  return {
    decision: good ? "approve" : "not_approve",
    selectedVerificationId:
      good?.verificationId ??
      attempts.find((a) => a.evidenceAvailable)?.verificationId ??
      null,
    reasons: good
      ? [
          `El intento ${good.verificationId} cumple todas las condiciones. Los demás intentos se conservan como evidencia.`,
        ]
      : discoveryError
        ? [discoveryError]
        : attempts.length
          ? [
              "Ningún intento cumple todas las condiciones; revisar los motivos de cada firma.",
            ]
          : [
              "No se encontraron validaciones para el préstamo de esta solicitud.",
            ],
    attempts,
  };
}

export function providerFingerprint(candidates: ProviderCandidate[]): string {
  // Signed media URLs rotate. They are retained privately as evidence, but
  // are not financial/decision changes and must not invalidate every read.
  function stable(v: unknown): unknown {
    if (typeof v === "string" && /^https?:\/\//.test(v)) {
      try {
        const url = new URL(v);
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch {
        return v;
      }
    }
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(object(v))
          .sort(([a], [b]) => a.localeCompare(b))
          .filter(
            ([k]) => !/persistentStoreFilePath|deviceFingerprint/i.test(k),
          )
          .map(([k, w]) => [k, stable(w)]),
      );
    return v;
  }
  return digest(
    [...candidates]
      .sort((a, b) => a.verificationId.localeCompare(b.verificationId))
      .map((c) => ({
        id: c.verificationId,
        error: c.error,
        originalStatus: c.originalStatus,
        completedAt: c.completedAt,
        resource: stable(c.resource),
      })),
  );
}

export function decisionDisparity(
  system: Decision,
  human: Decision,
  attempt: Attempt | null,
) {
  return {
    disagreesWithSystem: system !== human,
    overridesAttempt: human === "approve" && attempt?.decision !== "approve",
  };
}

// Human judgment may resolve a biometric/provider exception, but may not
// attach another person's or another loan's signed contract to this operation.
export function hasMatchingSignedOperation(attempt: Attempt | null, options: { requireCycle?: boolean } = {}) {
  const cycle = attempt?.checks.find(check => check.code === "cycle");
  return (cycle ? cycle.passed : !options.requireCycle) && ["operation", "dni", "amount", "installments", "installmentAmount"].every(
    code => attempt?.checks.some(check => check.code === code && check.passed),
  );
}
