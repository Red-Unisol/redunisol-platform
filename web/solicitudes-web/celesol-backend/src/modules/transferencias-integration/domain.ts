import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";

export class IntegrationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 409,
  ) {
    super(message);
    this.name = code;
  }
}
export function fail(code: string, message: string, status = 409): never {
  throw new IntegrationError(code, message, status);
}
export const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortedJson(item)]),
    );
  return value;
}
// PostgreSQL JSONB can reorder keys. Hash semantic JSON, including Decimal/Date
// serialization, so a persisted confirmation remains idempotent after a restart.
export const digest = (value: unknown) =>
  hash(JSON.stringify(sortedJson(JSON.parse(JSON.stringify(value)))));

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_:.-]+$/);
export const auditSchema = z.object({
  installationId: identifier,
  operator: z.string().trim().min(1).max(120),
});
export const reserveSchema = auditSchema
  .extend({
    idempotencyKey: z.string().uuid(),
    planVersion: z.string().regex(/^[a-f0-9]{64}$/),
    verificationId: identifier.nullable(),
    payments: z
      .array(
        z
          .object({
            paymentKey: identifier,
            bankTransactionId: identifier,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type ReservationInput = z.infer<typeof reserveSchema>;
export const confirmationSchema = auditSchema
  .extend({
    bankTransactionId: identifier,
    bankOperationId: identifier,
    amount: z.string().regex(/^\d+\.\d{2}$/),
    currency: z.literal("ARS"),
    cbu: z.string().regex(/^\d{22}$/),
    cuit: z.string().regex(/^\d{11}$/),
    confirmedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type Confirmation = z.infer<typeof confirmationSchema>;
export type Actor = { id: string; workflowOwnerId: string; clientId: string };
export type LoanFinancials = {
  loanId: string;
  lineId: string;
  cbu: string;
  cmf: string;
  coinag: string;
  cashInHand: string;
  memberCuit: string;
};
export interface FinancialGateway {
  loan(id: string, memberLegacyId: string): Promise<LoanFinancials>;
  creditor(id: string): Promise<{ cuit: string }>;
}
export type PlanSource = {
  id: string;
  nroSolicitud: string | null;
  legacyOid: string | null;
  montoAFinanciar: Prisma.Decimal | null;
  firmaDigitalmente: boolean;
  titular: {
    cbu: string | null;
    cbuNoHabitual: string | null;
    cuit: string | null;
    nroDocumento: string | null;
    nombre: string | null;
    apellidoDenominacion: string | null;
  } | null;
  cancelaciones: {
    id: string;
    monto: Prisma.Decimal;
    cbu: string;
    socio: string;
    socioLegacyId: string | null;
  }[];
};
export type PaymentLeg = {
  paymentKey: string;
  kind: "member" | "creditor";
  amount: string;
  cbu: string;
  cuit: string;
  name: string;
  // A decimal string, never derived from the UUID or linked loan ID.
  bankNumber?: string;
};
export type PaymentPlan = {
  source: "BEEX";
  solicitudId: string;
  nroSolicitud: string | null;
  prestamoLegacyId: string;
  financialLineId: string;
  currency: "ARS";
  requestedAmount: string;
  total: string;
  bank: "CMF" | "COINAG";
  requiresRenewalReview: boolean;
  verification: { requestNumber: string; document: string; required: boolean };
  member: { cuit: string; name: string };
  payments: PaymentLeg[];
  version: string;
};
export function money(value: string | Prisma.Decimal): Prisma.Decimal {
  const raw = String(value);
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw))
    fail(
      "INVALID_AMOUNT",
      "El importe debe ser decimal exacto con hasta dos decimales.",
    );
  const amount = new Prisma.Decimal(raw);
  if (amount.abs().gt("9999999999999999.99"))
    fail("INVALID_AMOUNT", "Importe fuera de rango.");
  return amount;
}
function digits(
  value: string | null | undefined,
  length: number,
  label: string,
) {
  const clean = (value ?? "").replace(/[-.\s]/g, "");
  if (!new RegExp(`^\\d{${length}}$`).test(clean))
    fail("INCOMPLETE_PLAN", `Falta ${label} válido.`);
  return clean;
}
export function buildPlan(
  source: PlanSource,
  loan: LoanFinancials,
  creditors: Map<string, string>,
): PaymentPlan {
  if (
    !source.legacyOid ||
    loan.loanId !== source.legacyOid ||
    !/^\d+$/.test(loan.lineId)
  )
    fail(
      "LOAN_MISMATCH",
      "El préstamo vinculado o su línea financiera no coincide.",
    );
  if (!source.montoAFinanciar || !source.titular)
    fail("INCOMPLETE_PLAN", "Faltan importe o titular.");
  const requested = money(source.montoAFinanciar);
  if (!requested.gt(0))
    fail("INVALID_AMOUNT", "El monto solicitado debe ser positivo.");
  const bankAmounts = [
    { bank: "CMF" as const, amount: money(loan.cmf).abs() },
    { bank: "COINAG" as const, amount: money(loan.coinag).abs() },
  ].filter(({ amount }) => amount.gt(0));
  if (bankAmounts.length !== 1)
    fail("BANK_AMOUNT_CONFLICT", "Debe existir un único monto bancario.");
  const { bank, amount: total } = bankAmounts[0]!;
  if (total.gt(requested))
    fail("TOTAL_MISMATCH", "El importe bancario supera el solicitado.");
  const payments: PaymentLeg[] = [];
  let cancellationTotal = new Prisma.Decimal(0);
  for (const item of [...source.cancelaciones].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const amount = money(item.monto);
    if (!amount.gt(0))
      fail("INVALID_AMOUNT", "Una cancelación tiene importe no positivo.");
    cancellationTotal = cancellationTotal.add(amount);
    const cuit = digits(creditors.get(item.id), 11, "CUIT del acreedor");
    if (!/^(30|33|34)/.test(cuit))
      fail(
        "INVALID_CREDITOR",
        "La cancelación requiere CUIT de persona jurídica.",
      );
    payments.push({
      paymentKey: `creditor:${item.id}`,
      kind: "creditor",
      amount: amount.toFixed(2),
      cbu: digits(item.cbu, 22, "CBU del acreedor"),
      cuit,
      name: item.socio,
    });
  }
  // Con cancelaciones el neto lo calcula el préstamo; nunca se infiere del bruto.
  const net = payments.length ? money(loan.cashInHand).abs() : total;
  if (
    payments.length &&
    (!cancellationTotal.add(net).eq(requested) || !total.eq(requested))
  )
    fail(
      "TOTAL_MISMATCH",
      "Cancelaciones + neto, total bancario y monto solicitado deben coincidir.",
    );
  const memberCuit = digits(source.titular.cuit, 11, "CUIT del titular");
  if (memberCuit !== digits(loan.memberCuit, 11, "CUIT del socio del préstamo"))
    fail(
      "LOAN_MISMATCH",
      "El socio del préstamo no coincide con el titular BEEX.",
    );
  if (net.gt(0)) {
    const cbu = digits(
      source.titular.cbuNoHabitual || source.titular.cbu,
      22,
      "CBU del titular",
    );
    if (cbu !== digits(loan.cbu, 22, "CBU del préstamo"))
      fail("ACCOUNT_MISMATCH", "El CBU de BEEX no coincide con el préstamo.");
    payments.unshift({
      paymentKey: "member",
      kind: "member",
      amount: net.toFixed(2),
      cbu,
      cuit: memberCuit,
      name: [source.titular.apellidoDenominacion, source.titular.nombre]
        .filter(Boolean)
        .join(" "),
    });
  }
  const document = (source.titular.nroDocumento ?? "").replace(/[-.\s]/g, "");
  if (!/^\d{7,8}$/.test(document))
    fail("INCOMPLETE_PLAN", "Falta documento del titular.");
  const plan = {
    source: "BEEX" as const,
    solicitudId: source.id,
    nroSolicitud: source.nroSolicitud,
    prestamoLegacyId: source.legacyOid,
    financialLineId: loan.lineId,
    currency: "ARS" as const,
    requestedAmount: requested.toFixed(2),
    total: total.toFixed(2),
    bank,
    requiresRenewalReview: total.lt(requested),
    verification: {
      requestNumber: source.legacyOid,
      document,
      required: source.firmaDigitalmente,
    },
    member: {
      cuit: memberCuit,
      name: [source.titular.apellidoDenominacion, source.titular.nombre].filter(Boolean).join(" "),
    },
    payments,
  };
  return { ...plan, version: digest(plan) };
}
