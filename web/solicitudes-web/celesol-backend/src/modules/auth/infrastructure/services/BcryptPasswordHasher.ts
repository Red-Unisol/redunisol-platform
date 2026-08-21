import bcrypt from "bcrypt";

import type { PasswordHasher } from "../../domain/services/PasswordHasher";

export class BcryptPasswordHasher implements PasswordHasher {
  compare(password: string, passwordHash: string) {
    return bcrypt.compare(password, passwordHash);
  }

  hash(password: string) {
    return bcrypt.hash(password, 12);
  }
}
