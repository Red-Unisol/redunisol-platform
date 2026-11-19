import type { AuthUser, AuthWorkflowOwner } from "../../domain/entities/User.entity";
import { userWorkflowAreas } from "../../domain/workflow-areas";

type StoredOwner = AuthWorkflowOwner & { isActive?: boolean };
const ownerSelect = { code: true, id: true, name: true, isActive: true } as const;

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
  workflowOwner?: StoredOwner | null;
  workflowOwnerMemberships?: { workflowOwner: StoredOwner }[];
};

export class UserMapper {
  static toDomain(user: PrismaUserShape): AuthUser {
    const workflowOwners = userWorkflowAreas(user);
    const representative = workflowOwners.find(area => area.id === user.workflowOwnerId)
      ?? workflowOwners[0] ?? null;
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
      workflowOwnerId: representative?.id ?? null,
      workflowOwner: representative,
      workflowOwners,
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
      workflowOwner: { select: ownerSelect },
      workflowOwnerMemberships: {
        select: { workflowOwner: { select: ownerSelect } },
        orderBy: { workflowOwner: { sortOrder: "asc" } },
      },
    } as const;
  }
}
