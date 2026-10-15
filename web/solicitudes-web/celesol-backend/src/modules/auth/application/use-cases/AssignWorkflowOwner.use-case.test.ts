import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WorkflowOwnerNotFoundOrInactiveError } from "../../domain/auth-errors";
import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import { USER_STATE } from "../../domain/user-state";
import { AssignWorkflowOwnerUseCase } from "./AssignWorkflowOwner.use-case";

describe("AssignWorkflowOwnerUseCase", () => {
  it("assigns workflow owner and marks user as active", async () => {
    const repository: AuthRepository = {
      countActiveSystemAdmins: async () => 0,
      assignWorkflowOwner: async () => ({
        email: "user@example.com",
        emailVerified: true,
        firstName: "User",
        id: "user-1",
        isSystemAdmin: false,
        lastName: "One",
        legacyUser: "UONE",
        recibeAsignacionAutomatica: false,
        state: USER_STATE.ACTIVE,
        workflowOwnerId: "owner-1",
      }),
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      findByIdWithPasswordHash: async () => null,
      updateUser: async () => {
        throw new Error("not used");
      },
      updatePasswordAndRevokeSessions: async () => {
        throw new Error("not used");
      },
      deleteById: async () => {
        throw new Error("not used");
      },
      findActiveById: async () => null,
      findActiveByIdentifier: async () => null,
      listActiveWorkflowOwners: async () => [],
      listUsers: async () => [],
      listPendingAreaUsers: async () => [],
      findActiveWorkflowOwnerById: async () => ({ id: "owner-1" }),
      findByEmail: async () => null,
      findByLegacyUser: async () => null,
      existsOtherUserWithLegacyUser: async () => false,
    };
    const useCase = new AssignWorkflowOwnerUseCase({
      userRepository: repository,
    });

    const user = await useCase.execute({
      userId: "user-1",
      workflowOwnerId: "owner-1",
    });

    assert.equal(user.state, USER_STATE.ACTIVE);
    assert.equal(user.workflowOwnerId, "owner-1");
  });

  it("rejects assignment for missing or inactive workflow owner", async () => {
    const repository: AuthRepository = {
      countActiveSystemAdmins: async () => 0,
      assignWorkflowOwner: async () => {
        throw new Error("not used");
      },
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      findByIdWithPasswordHash: async () => null,
      updateUser: async () => {
        throw new Error("not used");
      },
      updatePasswordAndRevokeSessions: async () => {
        throw new Error("not used");
      },
      deleteById: async () => {
        throw new Error("not used");
      },
      findActiveById: async () => null,
      findActiveByIdentifier: async () => null,
      listActiveWorkflowOwners: async () => [],
      listUsers: async () => [],
      listPendingAreaUsers: async () => [],
      findActiveWorkflowOwnerById: async () => null,
      findByEmail: async () => null,
      findByLegacyUser: async () => null,
      existsOtherUserWithLegacyUser: async () => false,
    };
    const useCase = new AssignWorkflowOwnerUseCase({
      userRepository: repository,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          userId: "user-1",
          workflowOwnerId: "owner-404",
        }),
      WorkflowOwnerNotFoundOrInactiveError,
    );
  });

  it("removes workflow owner when null is provided", async () => {
    let receivedInput: unknown;
    const repository: AuthRepository = {
      countActiveSystemAdmins: async () => 0,
      assignWorkflowOwner: async (input) => {
        receivedInput = input;

        return {
          email: "user@example.com",
          emailVerified: true,
          firstName: "User",
          id: "user-1",
          isSystemAdmin: false,
          lastName: "One",
          legacyUser: "UONE",
          recibeAsignacionAutomatica: false,
          state: USER_STATE.PENDING_AREA_ASSIGNMENT,
          workflowOwnerId: null,
        };
      },
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      findByIdWithPasswordHash: async () => null,
      updateUser: async () => {
        throw new Error("not used");
      },
      updatePasswordAndRevokeSessions: async () => {
        throw new Error("not used");
      },
      deleteById: async () => {
        throw new Error("not used");
      },
      findActiveById: async () => null,
      findActiveByIdentifier: async () => null,
      listActiveWorkflowOwners: async () => [],
      listUsers: async () => [],
      listPendingAreaUsers: async () => [],
      findActiveWorkflowOwnerById: async () => {
        throw new Error("not used");
      },
      findByEmail: async () => null,
      findByLegacyUser: async () => null,
      existsOtherUserWithLegacyUser: async () => false,
    };
    const useCase = new AssignWorkflowOwnerUseCase({
      userRepository: repository,
    });

    const user = await useCase.execute({
      userId: "user-1",
      workflowOwnerId: null,
    });

    assert.deepEqual(receivedInput, {
      userId: "user-1",
      workflowOwnerId: null,
    });
    assert.equal(user.state, USER_STATE.PENDING_AREA_ASSIGNMENT);
    assert.equal(user.workflowOwnerId, null);
  });
});
