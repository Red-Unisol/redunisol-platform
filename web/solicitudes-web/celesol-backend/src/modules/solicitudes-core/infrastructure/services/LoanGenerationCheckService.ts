import { Prisma, type PrismaClient } from "@prisma/client";
import { actingContext } from "../../../auth/impersonation/context";
import type { CreatePrestamoLegacyInput } from "../../application/dtos/CreatePrestamoLegacy.dto";
import { AdministrativeCorrectionError, coreConditionsFingerprint } from "../../domain/workflow/AdministrativeCorrection";
import { administrativeSource, assertAdministrativeActor, type CoreLoanSnapshot } from "./AdministrativeCorrectionService";
import type { InitialLoanGenerationService, InitialLoanReservation } from "./InitialLoanGenerationService";

export type GenerationLoan = CoreLoanSnapshot & { account: string | null; createdAt: string | null };
export type GenerationCheckInput = { requestId: string; expectedUpdatedAt: string };
type Actor = CreatePrestamoLegacyInput["currentUser"];
type Source = Awaited<ReturnType<typeof administrativeSource>>;
type Evidence = { stage: string; data: Prisma.JsonValue }[];
export type GenerationCheckResult = GenerationCheckInput & {
  status: "match" | "empty" | "ambiguous" | "blocked" | "unavailable";
  checkedAt: string; reason: string; candidate: GenerationLoan | null;
  canRecover: boolean; canRelease: boolean;
};
const control = (s: Source) => (s.administrativeCoreControl ?? {}) as Prisma.JsonObject;
const pending = (s: Source) => control(s).generationPending as unknown as InitialLoanReservation | undefined;
const dateOnly = (date: string | null | undefined) => date?.slice(0, 10) ?? null;

/** A successful empty Core search is necessary, but never proves non-delivery.
 * Release requires a fenced NOT_STARTED reservation or positive terminal evidence. */
export class LoanGenerationCheckService {
  constructor(private readonly deps: {
    db: PrismaClient;
    findLoans: (socioId: string, since: Date, knownLoanId?: string) => Promise<GenerationLoan[]>;
    generation: Pick<InitialLoanGenerationService, "recover">;
    now?: () => Date;
    creationTimeoutMs?: number;
  }) {}

  private load(s: Source, input: GenerationCheckInput) {
    const p = pending(s);
    if (!p || p.requestId !== input.requestId || s.updatedAt.toISOString() !== input.expectedUpdatedAt)
      throw new AdministrativeCorrectionError("La reserva cambió. Actualizá la solicitud y volvé a comprobar.");
    if (s.legacyOid || s.archivedAt || s.estadoActual.code !== "Confirmada" || s.desembolso || s.pagoExterno ||
      control(s).replacementPending || control(s).reliquidationHold || p.refinanciacionCobro ||
      coreConditionsFingerprint(s) !== p.sourceFingerprint)
      throw new AdministrativeCorrectionError("La solicitud requiere revisión administrativa antes de recuperar o liberar su generación.");
    return p;
  }

  private evidence(db: Prisma.TransactionClient, id: string, requestId: string) {
    return db.technicalDiagnosticEvent.findMany({
      where: { solicitudId: id, operationId: requestId, operation: "loan_generation",
        stage: { in: ["SUCCESS", "CREATED_REMOTE", "ERROR", "NOT_SENT"] } },
      select: { stage: true, data: true }, orderBy: { id: "asc" },
    });
  }

  private knownIds(p: InitialLoanReservation, evidence: Evidence) {
    const ids = new Set<string>();
    if (p.newLoanId) ids.add(p.newLoanId);
    for (const event of evidence) {
      const data = event.data as Prisma.JsonObject | null;
      const id = event.stage === "SUCCESS" ? data?.loanId : event.stage === "CREATED_REMOTE" ? data?.newLoanId : null;
      if (typeof id === "string" && /^[1-9]\d*$/.test(id)) ids.add(id);
    }
    return [...ids];
  }

  private safeNotSent(p: InitialLoanReservation, evidence: Evidence) {
    if (p.status === "CREATED" || p.beforeCreationPending !== false || p.refinanciacionCobro || this.knownIds(p, evidence).length) return false;
    if (p.status === "CREATING" && p.dispatchState === "NOT_STARTED") return true;
    return evidence.some(event => {
      const data = event.data as Prisma.JsonObject | null;
      if (event.stage === "NOT_SENT" && data?.remoteRequestSent === false) return true;
      if (event.stage !== "ERROR") return false;
      return data?.phase === "RESERVATION" || (data?.phase === "REMOTE_CREATION" &&
        (data.error as Prisma.JsonObject | null)?.name === "PrestamoLegacyNotSentError");
    });
  }

  async check(id: string, actor: Actor, input: GenerationCheckInput): Promise<GenerationCheckResult> {
    const s = await administrativeSource(this.deps.db, id);
    const p = this.load(s, input);
    const result: GenerationCheckResult = { ...input, checkedAt: (this.deps.now?.() ?? new Date()).toISOString(),
      status: "blocked", reason: "La generación requiere revisión.", candidate: null, canRecover: false, canRelease: false };
    const evidence = await this.evidence(this.deps.db, id, p.requestId);
    const known = this.knownIds(p, evidence);
    const members = p.coreInput.integrantes;
    const since = new Date(p.createdAt);
    if (known.length > 1 || members.length !== 1 || members[0]?.tipoRelacion !== "Titular" ||
      !/^[1-9]\d*$/.test(members[0]?.socio ?? "") || !Number.isFinite(since.getTime())) return result;
    let loans: GenerationLoan[];
    try { loans = await this.deps.findLoans(members[0]!.socio, since, known[0]); }
    catch { return { ...result, status: "unavailable", reason: "No pudimos completar la consulta del socio en Vimarx. La reserva sigue protegida; volvé a comprobar." }; }
    // A dispatch, payment or edit during the remote read invalidates this result.
    this.load(await administrativeSource(this.deps.db, id), input);
    const ownAdmin = actor.isSystemAdmin === true && !actingContext.getStore();
    if (loans.length === 0) {
      const safe = this.safeNotSent(p, evidence);
      return { ...result, status: "empty", canRelease: safe && ownAdmin,
        reason: safe ? "Vimarx no registra un préstamo del intento y comprobamos que la generación no se envió. Un administrador puede liberar la reserva."
          : "Vimarx no registra un préstamo del intento, pero no pudimos descartar que la generación termine más tarde. La reserva sigue protegida; requiere revisión administrativa." };
    }
    const matches = loans.filter(loan => loan.estado === 0 && (!known[0] || known[0] === loan.id) &&
      loan.amount === p.coreInput.montoDeseado && loan.cuotas === p.coreInput.cuotas && loan.lineaId === p.coreInput.lineaPrestamo &&
      loan.cancelacionesCentavos === (p.coreInput.nroLote ?? 0) &&
      (!p.coreInput.fechaPrimerVencimiento || dateOnly(loan.primerVencimiento) === dateOnly(p.coreInput.fechaPrimerVencimiento)));
    if (matches.length !== 1 || (!known[0] && loans.length !== 1))
      return { ...result, status: loans.length > 1 ? "ambiguous" : "blocked",
        reason: loans.length > 1 ? "Encontramos varios préstamos del socio desde el intento. Un administrador debe identificar el correcto; la reserva sigue protegida."
          : "El préstamo encontrado no coincide con el titular y las condiciones reservadas, o no está activo. La reserva sigue protegida." };
    const stillRunning = p.status === "CREATING" &&
      new Date(result.checkedAt).getTime() - since.getTime() <= (this.deps.creationTimeoutMs ?? 30000) + 60000;
    return { ...result, status: "match", candidate: matches[0]!, canRecover: ownAdmin && !stillRunning,
      reason: stillRunning ? "Encontramos un préstamo compatible, pero la generación todavía puede estar terminando. Esperá y volvé a comprobar."
        : "Encontramos un préstamo compatible en Vimarx. Un administrador puede comprobar sus datos y recuperar la vinculación." };
  }

  async recover(id: string, actor: Actor, input: GenerationCheckInput & { newLoanId: string; reason: string }) {
    assertAdministrativeActor(actor);
    const checked = await this.check(id, actor, input);
    if (!checked.canRecover || checked.candidate?.id !== input.newLoanId)
      throw new AdministrativeCorrectionError("La comprobación cambió o el préstamo requiere revisión. Volvé a comprobar antes de recuperarlo.");
    return this.deps.generation.recover(id, actor, input);
  }

  async release(id: string, actor: Actor, input: GenerationCheckInput & { reason: string }) {
    assertAdministrativeActor(actor);
    const checked = await this.check(id, actor, input);
    if (!checked.canRelease) throw new AdministrativeCorrectionError(checked.reason);
    await this.deps.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
      const s = await administrativeSource(tx, id);
      const p = this.load(s, input);
      const admin = await tx.user.findFirst({ where: { id: actor.id, isSystemAdmin: true, state: 1, deletedAt: null } });
      if (!admin) throw new AdministrativeCorrectionError("Se requiere un administrador activo.", 403);
      if (!this.safeNotSent(p, await this.evidence(tx, id, p.requestId)))
        throw new AdministrativeCorrectionError("El intento avanzó durante la comprobación. La reserva sigue protegida; actualizá la solicitud.");
      const rest = { ...control(s) }; delete rest.generationPending;
      await tx.solicitud.update({ where: { id }, data: {
        administrativeCoreControl: Object.keys(rest).length ? rest : Prisma.DbNull,
      } });
      await tx.solicitudEstadoHistorial.create({ data: {
        solicitudId: id, estadoAnteriorId: s.estadoActualId, estadoNuevoId: s.estadoActualId,
        fromStateCodeSnapshot: s.estadoActual.code, toStateCodeSnapshot: s.estadoActual.code,
        fromStateNameSnapshot: s.estadoActual.name, toStateNameSnapshot: s.estadoActual.name,
        fromOwnerIdSnapshot: s.estadoActual.ownerId, toOwnerIdSnapshot: s.estadoActual.ownerId,
        fromOwnerCodeSnapshot: s.estadoActual.owner.code, toOwnerCodeSnapshot: s.estadoActual.owner.code,
        fromOwnerNameSnapshot: s.estadoActual.owner.name, toOwnerNameSnapshot: s.estadoActual.owner.name,
        actionCode: "LOAN_GENERATION_RESERVATION_RELEASED", actionLabel: "Reserva de generación liberada",
        changedBy: actor.id, realActorUserId: actor.id, comentario: input.reason,
        metadata: { requestId: p.requestId, coreCheckedAt: checked.checkedAt, remoteRequestSent: false },
      } });
    });
    return { released: true };
  }
}
