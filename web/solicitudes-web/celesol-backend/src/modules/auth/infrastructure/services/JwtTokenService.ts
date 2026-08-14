import jwt from "jsonwebtoken";

import { InvalidSessionError } from "../../domain/auth-errors";
import type {
  AccessTokenPayload,
  AccessTokenService,
} from "../../domain/services/AccessTokenService";

export class JwtTokenService implements AccessTokenService {
  private readonly secret: string;
  private readonly ttlSeconds: number;

  constructor(input: { secret: string; ttlMinutes: number }) {
    this.secret = input.secret;
    this.ttlSeconds = input.ttlMinutes * 60;
  }

  sign(payload: AccessTokenPayload) {
    return jwt.sign({}, this.secret, {
      expiresIn: this.ttlSeconds,
      subject: payload.userId,
    });
  }

  verify(token: string): AccessTokenPayload {
    try {
      const decoded = jwt.verify(token, this.secret);

      if (
        typeof decoded !== "object" ||
        typeof decoded.sub !== "string" ||
        decoded.sub.length === 0
      ) {
        throw new InvalidSessionError();
      }

      return {
        userId: decoded.sub,
      };
    } catch (error) {
      if (error instanceof InvalidSessionError) {
        throw error;
      }

      throw new InvalidSessionError();
    }
  }
}
