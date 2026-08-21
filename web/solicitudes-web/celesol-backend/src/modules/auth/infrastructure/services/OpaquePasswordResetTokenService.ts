import { createHash, randomBytes } from "node:crypto";

import type { PasswordResetTokenService } from "../../domain/services/PasswordResetTokenService";

export class OpaquePasswordResetTokenService
  implements PasswordResetTokenService
{
  generate() {
    return randomBytes(48).toString("base64url");
  }

  hash(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }
}
