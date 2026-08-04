import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TooManyEmailRequestsError } from "../../domain/auth-errors";
import type { AuthUser } from "../../domain/entities/User.entity";
import type { PasswordResetTokenRecord } from "../../domain/entities/PasswordResetToken.entity";
import type { PasswordResetRepository } from "../../domain/repositories/PasswordResetRepository";
import type { PasswordResetEmailSender } from "../../domain/services/PasswordResetEmailSender";
import type { PasswordResetTokenService } from "../../domain/services/PasswordResetTokenService";
import { RequestPasswordResetUseCase } from "./RequestPasswordReset.use-case";

class FakePasswordResetRepository implements PasswordResetRepository {
  tokensCreatedInWindow = 0;
  createdForUserCalls = 0;

  async countCreatedSinceByUserId(input: { since: Date; userId: string }) {
    void input.since;
    void input.userId;
    return this.tokensCreatedInWindow;
  }

  async createForUser() {
    this.createdForUserCalls += 1;
  }

  async findActiveUserByEmail(email: string): Promise<AuthUser | null> {
    if (email === "missing@example.com") {
      return null;
    }

    return {
      email,
      emailVerified: true,
      firstName: "Test",
      id: "11111111-1111-1111-1111-111111111111",
      isSystemAdmin: false,
      lastName: "User",
      legacyUser: "legacy.user",
      state: 1,
      workflowOwnerId: "owner-1",
      workflowOwner: {
        code: "VENDEDORES",
        id: "owner-1",
        name: "Vendedores",
      },
    };
  }

  async findValidByHash(): Promise<PasswordResetTokenRecord | null> {
    return null;
  }

  async resetPasswordAndRevokeSessions() {}
}

class FakePasswordResetTokenService implements PasswordResetTokenService {
  generate() {
    return "token";
  }

  hash(token: string) {
    return `hash:${token}`;
  }
}

class FakePasswordResetEmailSender implements PasswordResetEmailSender {
  sentEmails = 0;

  async sendPasswordResetEmail() {
    this.sentEmails += 1;
  }
}

describe("RequestPasswordResetUseCase", () => {
  it("does nothing when user does not exist", async () => {
    const passwordResetRepository = new FakePasswordResetRepository();
    const passwordResetEmailSender = new FakePasswordResetEmailSender();
    const useCase = new RequestPasswordResetUseCase({
      config: {
        appOrigin: "http://localhost:5173",
        emailSendRateLimitMax: 5,
        emailSendRateLimitWindowMinutes: 15,
        passwordResetTokenTtlMinutes: 15,
      },
      passwordResetEmailSender,
      passwordResetRepository,
      passwordResetTokenService: new FakePasswordResetTokenService(),
    });

    await useCase.execute({ email: "missing@example.com" });

    assert.equal(passwordResetRepository.createdForUserCalls, 0);
    assert.equal(passwordResetEmailSender.sentEmails, 0);
  });

  it("rate limits password reset email after 5 attempts", async () => {
    const passwordResetRepository = new FakePasswordResetRepository();
    passwordResetRepository.tokensCreatedInWindow = 5;
    const passwordResetEmailSender = new FakePasswordResetEmailSender();
    const useCase = new RequestPasswordResetUseCase({
      config: {
        appOrigin: "http://localhost:5173",
        emailSendRateLimitMax: 5,
        emailSendRateLimitWindowMinutes: 15,
        passwordResetTokenTtlMinutes: 15,
      },
      passwordResetEmailSender,
      passwordResetRepository,
      passwordResetTokenService: new FakePasswordResetTokenService(),
    });

    await assert.rejects(
      () => useCase.execute({ email: "user@example.com" }),
      TooManyEmailRequestsError,
    );
    assert.equal(passwordResetRepository.createdForUserCalls, 0);
    assert.equal(passwordResetEmailSender.sentEmails, 0);
  });
});
