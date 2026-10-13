import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthUser } from "../domain/entities/User.entity";

export type ActingContext = {
  sessionId: string;
  administrator: AuthUser;
  selectedUser: AuthUser;
  auditId: string;
};
export const actingContext = new AsyncLocalStorage<ActingContext>();
export function actingHistoryFields() {
  const context = actingContext.getStore();
  return context
    ? {
        realActorUserId: context.administrator.id,
        impersonationSessionId: context.sessionId,
        operationAuditId: context.auditId,
      }
    : {};
}
