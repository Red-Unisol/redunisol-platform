import type { AuthUser } from "../../domain/entities/User.entity";

export type PrismaUserShape = {
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
  workflowOwner?: {
    code: string;
    id: string;
    name: string;
  } | null;
};

export class UserMapper {
  static toDomain(user: PrismaUserShape): AuthUser {
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
      workflowOwner: user.workflowOwner
        ? {
            code: user.workflowOwner.code,
            id: user.workflowOwner.id,
            name: user.workflowOwner.name,
          }
        : null,
    };
  }

  static profileSelect() {
    return {
      email: true,
      emailVerified: true,
      firstName: true,
      id: true,
      isSystemAdmin: true,
      lastName: true,
      legacyUser: true,
      recibeAsignacionAutomatica: true,
      state: true,
      workflowOwnerId: true,
      workflowOwner: {
        select: {
          code: true,
          id: true,
          name: true,
        },
      },
    } as const;
  }
}
