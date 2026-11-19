import type { Prisma } from "@prisma/client";
import type { AuthWorkflowOwner } from "./entities/User.entity";

export type AssignWorkflowOwnerInput =
  | { userId: string; workflowOwnerId: string | null }
  | { userId: string; workflowOwnerIds: string[] };

export type PendingAreaAssignment = {
  id: string;
  nroSolicitud: string | null;
  areaName: string;
  areaCode: string;
  stateName: string;
};

type Area = Partial<AuthWorkflowOwner> & { isActive?: boolean };

type WorkflowAreaUser = {
  workflowOwnerId?: string | null;
  workflowOwnerCode?: string | null;
  workflowOwner?: Area | null;
  workflowOwners?: readonly Area[];
  workflowOwnerMemberships?: readonly { workflowOwner: Area }[];
};

export const cumulativeWorkflowCodes = new Set(["RIESGO", "TESORERIA", "LEGAJOS_DIGITALES"]);

export function userWorkflowAreas(user: WorkflowAreaUser): AuthWorkflowOwner[] {
  let areas: readonly Area[];
  if (user.workflowOwners !== undefined) {
    areas = user.workflowOwners;
  } else if (user.workflowOwnerMemberships?.length) {
    areas = user.workflowOwnerMemberships.map(({ workflowOwner }) => workflowOwner);
  } else if (user.workflowOwner || user.workflowOwnerId || user.workflowOwnerCode) {
    areas = [{
      ...user.workflowOwner,
      code: user.workflowOwner?.code ?? user.workflowOwnerCode ?? undefined,
      id: user.workflowOwner?.id ?? user.workflowOwnerId ?? undefined,
    }];
  } else {
    return [];
  }
  return areas.filter(area => area.isActive !== false).map(area => ({
    id: area.id ?? "", code: area.code ?? "", name: area.name ?? "",
  }));
}

export function userWorkflowAreaIds(user: WorkflowAreaUser) {
  return userWorkflowAreas(user).map(area => area.id).filter(Boolean);
}

export function hasWorkflowArea(user: WorkflowAreaUser, code: string | null | undefined) {
  return !!code && userWorkflowAreas(user).some(area => area.code === code);
}

export function hasWorkflowAreaId(user: WorkflowAreaUser, id: string | null | undefined) {
  return !!id && userWorkflowAreaIds(user).includes(id);
}

export const workflowAreaInclude = {
  workflowOwner: true,
  workflowOwnerMemberships: { include: { workflowOwner: true } },
} as const;

export function activeWorkflowAreaWhere(
  criterion: string | { id: string },
  memberSinceAtMost?: Date,
): Prisma.UserWhereInput {
  const workflowOwner = typeof criterion === "string"
    ? { code: criterion, isActive: true }
    : { id: criterion.id, isActive: true };
  return {
    OR: [
      { workflowOwnerMemberships: { some: {
        workflowOwner,
        ...(memberSinceAtMost && { assignedAt: { lte: memberSinceAtMost } }),
      } } },
      { workflowOwnerMemberships: { none: {} }, workflowOwner },
    ],
  };
}
