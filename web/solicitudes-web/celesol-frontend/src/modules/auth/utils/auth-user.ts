import type { AuthUser } from "@/modules/auth/services/auth-api";

export const USER_STATE = {
  ACTIVE: 1,
  PENDING_AREA_ASSIGNMENT: 2,
  DISABLED: 0,
} as const;

export function isPendingAreaAssignment(user: AuthUser) {
  if (user.isSystemAdmin) {
    return false;
  }

  return (
    user.state === USER_STATE.PENDING_AREA_ASSIGNMENT ||
    user.workflowOwnerId === null
  );
}

export function canManageUsers(user: AuthUser | null | undefined) {
  return user?.isSystemAdmin === true;
}

export function canCreateSocio(user: AuthUser | null | undefined) {
  return user?.isSystemAdmin === true || user?.workflowOwner?.code === "RIESGO";
}

export function canEditSocio(user: AuthUser | null | undefined) {
  return user?.isSystemAdmin === true || user?.workflowOwner?.code === "RIESGO";
}

export function canDeleteSocio(user: AuthUser | null | undefined) {
  return user?.isSystemAdmin === true || user?.workflowOwner?.code === "RIESGO";
}

export function canAccessRiesgoTools(user: AuthUser | null | undefined) {
  return user?.isSystemAdmin === true || user?.workflowOwner?.code === "RIESGO";
}

export function canCreateSolicitud(user: AuthUser | null | undefined) {
  return user?.isSystemAdmin === true || user?.workflowOwner?.code !== "RIESGO";
}

export type DashboardVariant = "admin" | "analista" | "vendedor";

export function getDefaultAuthenticatedRoute(user: AuthUser) {
  if (isPendingAreaAssignment(user)) {
    return "/pending-area";
  }

  return "/dashboard";
}

export function resolveDashboardVariant(user: AuthUser): DashboardVariant {
  if (canManageUsers(user)) {
    return "admin";
  }

  const ownerSignal =
    `${user.workflowOwner?.code ?? ""} ${user.workflowOwner?.name ?? ""}`
      .trim()
      .toLowerCase();

  if (
    ownerSignal.includes("riesgo") ||
    ownerSignal.includes("analista") ||
    ownerSignal.includes("analisis")
  ) {
    return "analista";
  }

  return "vendedor";
}
