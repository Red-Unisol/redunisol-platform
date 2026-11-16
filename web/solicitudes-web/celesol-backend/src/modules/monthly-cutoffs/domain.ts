import type { AuthUser } from "../auth/domain/entities/User.entity";
export const AMEJUCA_LINE_IDS = [
  "2519",
  "2657",
  "2770",
  "2771",
  "2772",
  "2774",
  "2776",
] as const;
export function isAmejucaLine(id: string | number) {
  return (AMEJUCA_LINE_IDS as readonly string[]).includes(String(id));
}
export function canManageMonthlyCutoffs(
  user: Pick<AuthUser, "isSystemAdmin" | "workflowOwner">,
) {
  return user.isSystemAdmin || user.workflowOwner?.code === "RIESGO";
}
export class MonthlyCutoffError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "MonthlyCutoffError";
  }
}
export function businessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function validatePeriod(period: string) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period))
    throw new MonthlyCutoffError(
      "Elegí un período válido entre enero de 2000 y diciembre de 2099.",
    );
  return period;
}
export function validateCutoffDate(period: string, date: string) {
  validatePeriod(period);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !date.startsWith(period + "-") ||
    !Number.isFinite(Date.parse(date + "T00:00:00Z")) ||
    new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date
  )
    throw new MonthlyCutoffError(
      "La fecha de corte debe ser una fecha real dentro del mes seleccionado.",
    );
  return date;
}
export function firstDueDate(emissionDate: string, cutoffDate: string) {
  validateCutoffDate(emissionDate.slice(0, 7), emissionDate);
  validateCutoffDate(emissionDate.slice(0, 7), cutoffDate);
  const [year, month] = emissionDate.split("-").map(Number);
  return new Date(
    Date.UTC(year, month + (emissionDate > cutoffDate ? 1 : 0), 0),
  )
    .toISOString()
    .slice(0, 10);
}
export type CutoffRecord = {
  period: string;
  cutoffDate: string;
  note: string | null;
  version: number;
  updatedAt: string;
  updatedBy: string;
};
export type CutoffChange = CutoffRecord & { previousDate: string | null };
export type CutoffRepository = {
  find(period: string): Promise<CutoffRecord | null>;
  history(period: string): Promise<CutoffChange[]>;
  save(input: {
    period: string;
    cutoffDate: string;
    note: string | null;
    expectedVersion: number;
    actorId: string;
    actorName: string;
    realActorId: string;
  }): Promise<CutoffRecord>;
};
export class MonthlyCutoffService {
  constructor(
    private readonly repository: CutoffRepository,
    private readonly today = businessDate,
  ) {}
  async get(period: string) {
    validatePeriod(period);
    const [record, history] = await Promise.all([
      this.repository.find(period),
      this.repository.history(period),
    ]);
    return {
      group: "AMEJUCA" as const,
      period,
      status: record ? ("confirmed" as const) : ("estimated" as const),
      record,
      history,
    };
  }
  async save(
    period: string,
    input: {
      cutoffDate: string;
      note?: string | null;
      expectedVersion: number;
    },
    actor: AuthUser,
    realActorId = actor.id,
  ) {
    if (!canManageMonthlyCutoffs(actor))
      throw new MonthlyCutoffError(
        "Sólo los analistas de Riesgo y administradores pueden configurar cortes.",
        403,
      );
    validateCutoffDate(period, input.cutoffDate);
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0
    )
      throw new MonthlyCutoffError("Versión de corte inválida.");
    if (
      input.note != null &&
      (typeof input.note !== "string" || input.note.length > 1000)
    )
      throw new MonthlyCutoffError(
        "La observación admite hasta 1000 caracteres.",
      );
    return this.repository.save({
      period,
      cutoffDate: input.cutoffDate,
      note: input.note?.trim() || null,
      expectedVersion: input.expectedVersion,
      actorId: actor.id,
      realActorId,
      actorName:
        [actor.firstName, actor.lastName].filter(Boolean).join(" ") ||
        actor.legacyUser,
    });
  }
  async resolve(lineId: string | number, emissionDate = this.today()) {
    if (!isAmejucaLine(lineId)) return null;
    validateCutoffDate(emissionDate.slice(0, 7), emissionDate);
    const record = await this.repository.find(emissionDate.slice(0, 7));
    return record
      ? { record, firstDueDate: firstDueDate(emissionDate, record.cutoffDate) }
      : null;
  }
}
