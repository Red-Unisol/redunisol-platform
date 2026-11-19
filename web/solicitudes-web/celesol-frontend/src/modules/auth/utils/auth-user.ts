import type {
  AuthUser,
  AuthWorkflowOwner,
} from "@/modules/auth/services/auth-api";

export const USER_STATE = {
  ACTIVE: 1,
  PENDING_AREA_ASSIGNMENT: 2,
  DISABLED: 0,
} as const;

type AreaProfile = {
  workflowOwners?: AuthWorkflowOwner[];
  workflowOwner?: AuthWorkflowOwner | null;
  workflowOwnerId?: string | null;
};

export function userAreas(user?: AreaProfile | null): AuthWorkflowOwner[] {
  return (
    user?.workflowOwners ?? (user?.workflowOwner ? [user.workflowOwner] : [])
  );
}

export function userAreaIds(user: AreaProfile): string[] {
  if (user.workflowOwners || user.workflowOwner)
    return userAreas(user).map((area) => area.id);
  return user.workflowOwnerId ? [user.workflowOwnerId] : [];
}

export function hasArea(user: AreaProfile | null | undefined, code: string) {
  return userAreas(user).some((area) => area.code === code);
}

export function onlyArea(user: AreaProfile | null | undefined, code: string) {
  const areas = userAreas(user);
  return areas.length === 1 && areas[0].code === code;
}

export function areaName(area: AuthWorkflowOwner) {
  return area.code === "RIESGO" ? "Análisis" : area.name;
}

export function isPendingAreaAssignment(user: AuthUser) {
  if (user.isSystemAdmin) {
    return false;
  }

  return (
    user.state === USER_STATE.PENDING_AREA_ASSIGNMENT ||
    userAreaIds(user).length === 0
  );
}

export function canManageUsers(user: AuthUser | null | undefined) {
  return user?.isSystemAdmin === true;
}

export function canCreateSocio(user: AuthUser | null | undefined) {
  return user?.isSystemAdmin === true || hasArea(user, "RIESGO");
}

export function canEditSocio(user: AuthUser | null | undefined) {
  return user?.isSystemAdmin === true || hasArea(user, "RIESGO");
}

// Borrar un socio queda solo para admin. El backend hace el mismo chequeo.
export function canDeleteSocio(user: AuthUser | null | undefined) {
  return user?.isSystemAdmin === true;
}

export function isVendedor(user: AuthUser | null | undefined) {
  return user?.isSystemAdmin !== true && onlyArea(user, "VENDEDORES");
}

export function canAccessRiesgoTools(user: AuthUser | null | undefined) {
  return user?.isSystemAdmin === true || hasArea(user, "RIESGO");
}

export function canReviewSignatures(user: AuthUser | null | undefined) {
  return user?.isSystemAdmin === true || hasArea(user, "LEGAJOS_DIGITALES");
}

// Los prestamos que el socio ya tiene con la mutual son informacion para
// analizar, no para cargar: Vendedores no los ve. El backend hace el mismo
// chequeo, esto solo evita mostrar una pestaña que va a dar 403.
export function canViewPrestamosDelSocio(user: AuthUser | null | undefined) {
  return user?.isSystemAdmin === true || !onlyArea(user, "VENDEDORES");
}

export function canCreateSolicitud(user: AuthUser | null | undefined) {
  return user?.isSystemAdmin === true || !onlyArea(user, "RIESGO");
}

export type DashboardVariant = "admin" | "analista" | "vendedor";

export function getDefaultAuthenticatedRoute(user: AuthUser) {
  if (isPendingAreaAssignment(user)) {
    return "/pending-area";
  }

  if (!user.isSystemAdmin && userAreas(user).length > 1) {
    return "/solicitudes/core/recientes";
  }

  // Se entra a Precarga; quien no puede cargar solicitudes no la tiene en el menú.
  return canCreateSolicitud(user)
    ? "/solicitudes/core/precarga"
    : "/solicitudes/core/recientes";
}

export function resolveDashboardVariant(user: AuthUser): DashboardVariant {
  if (canManageUsers(user)) {
    return "admin";
  }

  if (
    userAreas(user).some((area) =>
      /riesgo|analista|analisis/i.test(`${area.code} ${area.name}`),
    )
  ) {
    return "analista";
  }

  return "vendedor";
}
