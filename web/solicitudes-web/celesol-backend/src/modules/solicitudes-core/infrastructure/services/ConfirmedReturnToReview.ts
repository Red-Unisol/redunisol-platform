import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { actingContext } from "../../../auth/impersonation/context";
import { administrativeSource, correctionBlockedReason } from "./AdministrativeCorrectionService";
import { AdministrativeCorrectionError } from "../../domain/workflow/AdministrativeCorrection";
import { ForbiddenSolicitudAccessError, SolicitudWorkflowCommentRequiredError, WorkflowExecutionPlanStateConflictError } from "../../domain/solicitudes-core-errors";

export function isConfirmedReturnToReview(from: string, to: string) {
  return from === "Confirmada" && to === "Revisar";
}

// This is a regular catalog transition. It uses the same financial safety
// boundaries as the administrative correction while preserving its own audit.
export async function prepareConfirmedReturnToReview(db: Prisma.TransactionClient, input: {
  solicitudId: string; changedBy: string; comment: string | null; now: Date; expectedUpdatedAt: Date;
}) {
  await db.$queryRaw`SELECT id FROM solicitudes WHERE id = ${input.solicitudId}::uuid FOR UPDATE`;
  const source = await administrativeSource(db, input.solicitudId);
  if (source.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())
    throw new WorkflowExecutionPlanStateConflictError();
  if (!input.comment?.trim()) throw new SolicitudWorkflowCommentRequiredError();
  const actor = await db.user.findFirst({ where: { id: input.changedBy, state: 1, deletedAt: null } });
  if (!actor || (!actor.isSystemAdmin && actor.workflowOwnerId !== source.estadoActual.ownerId))
    throw new ForbiddenSolicitudAccessError();
  const blocked = await correctionBlockedReason(db, source);
  if (blocked) throw new AdministrativeCorrectionError(blocked);
  const id = randomUUID();
  const control = source.legacyOid ? {
    ...(source.administrativeCoreControl as Prisma.JsonObject | null),
    correctionId: id, loanId: source.legacyOid, correctedAt: input.now.toISOString(),
    reconciledFingerprint: null,
  } satisfies Prisma.InputJsonObject : undefined;
  return {
    control,
    audit: {
      id,
      realActorUserId: actingContext.getStore()?.administrator.id ?? actor.id,
      metadata: {
        event: "CONFIRMADA_TO_REVISAR", correctionId: id, legacyOid: source.legacyOid,
        assignedToUserId: source.assignedToUserId, coreReconciliationRequired: Boolean(source.legacyOid),
      },
    },
  };
}
