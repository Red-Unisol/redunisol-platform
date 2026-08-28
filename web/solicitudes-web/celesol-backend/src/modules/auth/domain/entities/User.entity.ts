export type AuthWorkflowOwner = {
  code: string;
  id: string;
  name: string;
};

export type AuthUser = {
  email: string;
  emailVerified: boolean;
  firstName: string | null;
  id: string;
  isSystemAdmin: boolean;
  lastName: string | null;
  legacyUser: string;
  recibeAsignacionAutomatica: boolean;
  state: number;
  workflowOwnerId: string | null;
  workflowOwner?: AuthWorkflowOwner | null;
};

export type PersistedAuthUser = AuthUser & {
  passwordHash: string;
};

export function toAuthUser(user: PersistedAuthUser): AuthUser {
  return {
    email: user.email,
    emailVerified: user.emailVerified,
    firstName: user.firstName,
    id: user.id,
    isSystemAdmin: user.isSystemAdmin,
    lastName: user.lastName,
    legacyUser: user.legacyUser,
    recibeAsignacionAutomatica: user.recibeAsignacionAutomatica,
    state: user.state,
    workflowOwnerId: user.workflowOwnerId,
    workflowOwner: user.workflowOwner ?? null,
  };
}

