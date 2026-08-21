import type { RequestMetadata } from "../../domain/entities/RefreshToken.entity";

export type RefreshTokenDto = {
  metadata: RequestMetadata;
  refreshToken: string | undefined;
};
