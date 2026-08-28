export type UpdateUserInput = {
  authenticatedUserId: string;
  userId: string;
  email?: string;
  firstName?: string;
  isSystemAdmin?: boolean;
  lastName?: string;
  legacyUser?: string;
  recibeAsignacionAutomatica?: boolean;
  state?: 0 | 1;
};
