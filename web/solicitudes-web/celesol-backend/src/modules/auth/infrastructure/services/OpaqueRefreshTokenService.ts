import { createHash, randomBytes } from "node:crypto";

import type { RefreshTokenService } from "../../domain/services/RefreshTokenService";

export class OpaqueRefreshTokenService implements RefreshTokenService {
  generate() {
    return randomBytes(48).toString("base64url");
  }

  hash(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }
}
