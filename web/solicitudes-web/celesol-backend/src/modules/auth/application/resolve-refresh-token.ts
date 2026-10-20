import { isRefreshTokenActive } from "../domain/entities/RefreshToken.entity";
import type { RefreshTokenRepository } from "../domain/repositories/RefreshTokenRepository";
import type { RefreshTokenService } from "../domain/services/RefreshTokenService";

export const REFRESH_RECOVERY_WINDOW_MS = 30_000;

/** Only the immediately replaced token can recover its still-active successor. */
export async function resolveRefreshToken(
  value: string,
  repository: RefreshTokenRepository,
  service: RefreshTokenService,
) {
  const record = await repository.findByHash(service.hash(value));
  const now = new Date();
  if (!record) return null;
  if (isRefreshTokenActive(record, now)) {
    return { record, value, recovered: false };
  }
  if (
    !record.revokedAt ||
    !record.replacedByTokenHash ||
    record.expiresAt <= now ||
    record.revokedAt > now ||
    now.getTime() - record.revokedAt.getTime() >= REFRESH_RECOVERY_WINDOW_MS
  )
    return null;

  const successor = service.successor(value);
  if (service.hash(successor) !== record.replacedByTokenHash) return null;
  const next = await repository.findByHash(record.replacedByTokenHash);
  const checkedAt = new Date();
  if (
    !next ||
    next.userId !== record.userId ||
    !isRefreshTokenActive(next, checkedAt) ||
    checkedAt.getTime() - record.revokedAt.getTime() >=
      REFRESH_RECOVERY_WINDOW_MS
  ) {
    return null;
  }
  return { record: next, value: successor, recovered: true };
}
