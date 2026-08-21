import { createHash } from "node:crypto";

import type { VerificationCodeHasher } from "../../domain/services/VerificationCodeHasher";

export class Sha256VerificationCodeHasher implements VerificationCodeHasher {
  hash(code: string) {
    return createHash("sha256").update(code).digest("hex");
  }
}
