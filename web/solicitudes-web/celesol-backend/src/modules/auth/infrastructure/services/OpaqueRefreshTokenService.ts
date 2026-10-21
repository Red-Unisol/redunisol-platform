import { createHash, createHmac, randomBytes } from "node:crypto";

import type { RefreshTokenService } from "../../domain/services/RefreshTokenService";

export class OpaqueRefreshTokenService implements RefreshTokenService {
  constructor(private readonly rotationSecret: string) {}

  // Reproduce only this token's successor after a lost response. The purpose
  // prefix separates this HMAC from access-token signing with the same key.
  successor(token: string) {
    return createHmac("sha256", this.rotationSecret)
      .update("beex/refresh-successor/v1\0")
      .update(token)
      .digest("base64url");
  }

  generate() {
    return randomBytes(48).toString("base64url");
  }

  hash(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }
}
