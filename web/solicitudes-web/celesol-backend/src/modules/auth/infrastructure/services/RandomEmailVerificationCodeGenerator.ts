import { randomInt } from "node:crypto";

import type { EmailVerificationCodeGenerator } from "../../domain/services/EmailVerificationCodeGenerator";

export class RandomEmailVerificationCodeGenerator
  implements EmailVerificationCodeGenerator
{
  generate() {
    return String(randomInt(0, 1_000_000)).padStart(6, "0");
  }
}
