import type { AuthUser, PersistedAuthUser } from "../entities/User.entity";

export type AuthRepository = {
  findById(userId: string): Promise<AuthUser | null>;
  findByIdWithPasswordHash(userId: string): Promise<PersistedAuthUser | null>;
  countActiveSystemAdmins(): Promise<number>;
  updateUser(input: {
    id: string;
    email?: string;
    emailVerified?: boolean;
    firstName?: string;
    isSystemAdmin?: boolean;
    lastName?: string;
    legacyUser?: string;
    recibeAsignacionAutomatica?: boolean;
    state?: number;
  }): Promise<AuthUser>;
  updatePasswordAndRevokeSessions(input: {
    userId: string;
    passwordHash: string;
  }): Promise<void>;
  listUsers(): Promise<AuthUser[]>;
  listPendingAreaUsers(): Promise<AuthUser[]>;
  listActiveWorkflowOwners(): Promise<
    Array<{
      code: string;
      id: string;
      name: string;
    }>
  >;
  create(input: {
    email: string;
    firstName: string;
    lastName: string;
    legacyUser: string;
    passwordHash: string;
    state?: number;
    workflowOwnerId?: string | null;
  }): Promise<AuthUser>;
  assignWorkflowOwner(input: {
    userId: string;
    workflowOwnerId: string | null;
  }): Promise<AuthUser>;
  deleteById(userId: string): Promise<void>;
  findActiveById(userId: string): Promise<AuthUser | null>;
  findActiveByIdentifier(identifier: string): Promise<PersistedAuthUser | null>;
  findByEmail(email: string): Promise<AuthUser | null>;
  findByLegacyUser(legacyUser: string): Promise<AuthUser | null>;
  existsOtherUserWithLegacyUser(input: {
    excludeUserId: string;
    legacyUser: string;
  }): Promise<boolean>;
  findActiveWorkflowOwnerById(workflowOwnerId: string): Promise<{ id: string } | null>;
};
