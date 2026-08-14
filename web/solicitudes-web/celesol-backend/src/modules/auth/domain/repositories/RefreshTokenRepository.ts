import type {
  RefreshTokenRecord,
  RequestMetadata,
} from "../entities/RefreshToken.entity";

export type RefreshTokenRepository = {
  create(input: {
    expiresAt: Date;
    metadata: RequestMetadata;
    tokenHash: string;
    userId: string;
  }): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revoke(tokenHash: string, replacedByTokenHash?: string): Promise<void>;
  rotate(input: {
    currentTokenHash: string;
    expiresAt: Date;
    metadata: RequestMetadata;
    newTokenHash: string;
    userId: string;
  }): Promise<boolean>;
};
