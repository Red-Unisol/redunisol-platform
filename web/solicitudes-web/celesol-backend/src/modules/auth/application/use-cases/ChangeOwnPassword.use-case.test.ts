import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  InvalidCurrentPasswordError,
  UserNotFoundError,
} from "../../domain/auth-errors";
import type { PersistedAuthUser } from "../../domain/entities/User.entity";
import type { PasswordHasher } from "../../domain/services/PasswordHasher";
import { ChangeOwnPasswordUseCase } from "./ChangeOwnPassword.use-case";

const existingUser: PersistedAuthUser = {
  email: "user@example.com",
  emailVerified: true,
  firstName: "User",
  id: "11111111-1111-1111-1111-111111111111",
  isSystemAdmin: false,
  lastName: "User",
  legacyUser: "UUSER",
  passwordHash: "hashed:CurrentPass1!",
  state: 1,
  workflowOwnerId: null,
};

class FakePasswordHasher implements PasswordHasher {
  async compare(password: string, passwordHash: string): Promise<boolean> {
    return passwordHash === `hashed:${password}`;
  }

  async hash(password: string): Promise<string> {
    return `hashed:${password}`;
  }
}

function buildUseCase(user: PersistedAuthUser | null) {
  const updateCalls: Array<{ userId: string; passwordHash: string }> = [];

  const useCase = new ChangeOwnPasswordUseCase({
    passwordHasher: new FakePasswordHasher(),
    userRepository: {
      findByIdWithPasswordHash: async (userId: string) =>
        user && user.id === userId ? user : null,
      updatePasswordAndRevokeSessions: async (input: { userId: string; passwordHash: string }) => {
        updateCalls.push(input);
      },
    } as never,
  });

  return { updateCalls, useCase };
}

describe("ChangeOwnPasswordUseCase", () => {
  it("changes the password when the current password matches", async () => {
    const { updateCalls, useCase } = buildUseCase(existingUser);

    await useCase.execute({
      currentPassword: "CurrentPass1!",
      newPassword: "NewPass1!",
      userId: existingUser.id,
    });

    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0]?.userId, existingUser.id);
    assert.equal(updateCalls[0]?.passwordHash, "hashed:NewPass1!");
  });

  it("throws InvalidCurrentPasswordError when the current password does not match", async () => {
    const { updateCalls, useCase } = buildUseCase(existingUser);

    await assert.rejects(
      () =>
        useCase.execute({
          currentPassword: "WrongPass1!",
          newPassword: "NewPass1!",
          userId: existingUser.id,
        }),
      InvalidCurrentPasswordError,
    );
    assert.equal(updateCalls.length, 0);
  });

  it("throws UserNotFoundError when the user does not exist", async () => {
    const { useCase } = buildUseCase(null);

    await assert.rejects(
      () =>
        useCase.execute({
          currentPassword: "CurrentPass1!",
          newPassword: "NewPass1!",
          userId: "does-not-exist",
        }),
      UserNotFoundError,
    );
  });
});
