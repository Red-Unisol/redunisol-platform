import {
  AuthConflictError,
  InvalidRequestError,
  LastActiveSystemAdminDeactivationError,
  LastActiveSystemAdminDemotionError,
  SelfDeactivationError,
  SelfSystemAdminDemotionError,
  UserNotFoundError,
} from "../../domain/auth-errors";
import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import { USER_STATE } from "../../domain/user-state";
import type { UpdateUserInput } from "../dtos/UpdateUser.dto";

type UpdateUserUseCaseDependencies = {
  userRepository: AuthRepository;
};

export class UpdateUserUseCase {
  private readonly userRepository: AuthRepository;

  constructor(dependencies: UpdateUserUseCaseDependencies) {
    this.userRepository = dependencies.userRepository;
  }

  async execute(input: UpdateUserInput) {
    const targetUser = await this.userRepository.findById(input.userId);

    if (!targetUser) {
      throw new UserNotFoundError();
    }

    const normalizedEmail =
      input.email === undefined ? undefined : input.email.trim().toLowerCase();
    const normalizedFirstName =
      input.firstName === undefined ? undefined : input.firstName.trim();
    const normalizedLastName =
      input.lastName === undefined ? undefined : input.lastName.trim();
    const normalizedLegacyUser =
      input.legacyUser === undefined
        ? undefined
        : input.legacyUser.trim().toLowerCase();
    const nextIsSystemAdmin = input.isSystemAdmin ?? targetUser.isSystemAdmin;
    const nextState = input.state ?? targetUser.state;
    const isTargetActiveAdmin =
      targetUser.isSystemAdmin && targetUser.state === USER_STATE.ACTIVE;
    const removesAdmin =
      targetUser.isSystemAdmin && input.isSystemAdmin === false;
    const deactivatesUser =
      targetUser.state === USER_STATE.ACTIVE && input.state === USER_STATE.INACTIVE;

    if (
      input.authenticatedUserId === targetUser.id &&
      input.isSystemAdmin === false
    ) {
      throw new SelfSystemAdminDemotionError();
    }

    if (
      input.authenticatedUserId === targetUser.id &&
      input.state === USER_STATE.INACTIVE
    ) {
      throw new SelfDeactivationError();
    }

    if (isTargetActiveAdmin && (!nextIsSystemAdmin || nextState !== USER_STATE.ACTIVE)) {
      const activeAdmins = await this.userRepository.countActiveSystemAdmins();

      if (activeAdmins <= 1) {
        if (removesAdmin) {
          throw new LastActiveSystemAdminDemotionError();
        }

        if (deactivatesUser) {
          throw new LastActiveSystemAdminDeactivationError();
        }
      }
    }

    if (input.firstName !== undefined) {
      if (normalizedFirstName === undefined || normalizedFirstName.length === 0) {
        throw new InvalidRequestError("Request body invalido.");
      }
    }

    if (input.lastName !== undefined) {
      if (normalizedLastName === undefined || normalizedLastName.length === 0) {
        throw new InvalidRequestError("Request body invalido.");
      }
    }

    if (input.legacyUser !== undefined) {
      if (
        normalizedLegacyUser === undefined ||
        normalizedLegacyUser.length === 0
      ) {
        throw new InvalidRequestError("Request body invalido.");
      }
    }

    if (normalizedLegacyUser !== undefined) {
      const hasLegacyUserDuplicate =
        await this.userRepository.existsOtherUserWithLegacyUser({
          excludeUserId: targetUser.id,
          legacyUser: normalizedLegacyUser,
        });

      if (hasLegacyUserDuplicate) {
        throw new AuthConflictError("Legacy user already registered.");
      }
    }

    return this.userRepository.updateUser({
      email: normalizedEmail,
      firstName: normalizedFirstName,
      id: targetUser.id,
      isSystemAdmin: input.isSystemAdmin,
      lastName: normalizedLastName,
      legacyUser: normalizedLegacyUser,
      state: input.state,
    });
  }
}
