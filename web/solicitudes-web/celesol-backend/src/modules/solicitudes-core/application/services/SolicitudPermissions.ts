import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import type { SolicitudFieldAccessRuleRecord } from "../../domain/repositories/SolicitudFieldAccessRulesRepository";

export type SolicitudPermissionUser = {
  id: string;
  isAnalista?: boolean;
  isSystemAdmin?: boolean;
  workflowOwnerId: string | null;
  workflowOwnerCode?: string | null;
};

export type SolicitudPermissionAction =
  | "EDIT_DATA"
  | "VIEW_HISTORY"
  | "DOWNLOAD_ATTACHMENT"
  | "UPLOAD_ATTACHMENT"
  | "DELETE_ATTACHMENT"
  | "MANAGE_CANCELACIONES"
  | "CHANGE_STATE";

export type SolicitudCapabilities = {
  canView: boolean;
  canEdit: boolean;
  canUploadAdjuntos: boolean;
  canDeleteAdjuntos: boolean;
  canDownloadAdjuntos: boolean;
  canManageCancelaciones: boolean;
  canChangeState: boolean;
  canViewHistory: boolean;
};

type SolicitudPermissionTarget = Pick<
  SolicitudCore,
  "estadoActual"
>;

export function canViewSolicitud(
  _user: SolicitudPermissionUser,
  _solicitud: SolicitudPermissionTarget,
) {
  return true;
}

export function canEditSolicitud(
  user: SolicitudPermissionUser,
  solicitud: SolicitudPermissionTarget,
  action: SolicitudPermissionAction,
  fieldAccess: Pick<
    SolicitudFieldAccessRuleRecord,
    "active" | "canManageAttachments" | "workflowStateId"
  > | null = null,
) {
  if (user.isSystemAdmin) {
    return true;
  }

  if (action === "VIEW_HISTORY" || action === "DOWNLOAD_ATTACHMENT") {
    return true;
  }

  if (
    action === "UPLOAD_ATTACHMENT" ||
    action === "DELETE_ATTACHMENT" ||
    action === "MANAGE_CANCELACIONES"
  ) {
    return canManageSolicitudAttachments({
      fieldAccess,
      solicitud,
      user,
    });
  }

  if (action === "EDIT_DATA" && user.isAnalista) {
    return true;
  }

  // Excepcion puntual: desde "Transferir", un usuario del owner RIESGO
  // tambien puede cambiar el estado (ejecutar "pagar"), ademas del owner
  // actual (TESORERIA). No aplica a ningun otro estado ni accion.
  if (
    action === "CHANGE_STATE" &&
    solicitud.estadoActual.code === "Transferir" &&
    user.workflowOwnerCode === "RIESGO"
  ) {
    return true;
  }

  return isCurrentOwnerUser(user, solicitud);
}

export function buildSolicitudCapabilities(
  user: SolicitudPermissionUser,
  solicitud: SolicitudPermissionTarget,
  fieldAccess: Pick<
    SolicitudFieldAccessRuleRecord,
    "active" | "canManageAttachments" | "workflowStateId"
  > | null = null,
): SolicitudCapabilities {
  return {
    canChangeState: canEditSolicitud(user, solicitud, "CHANGE_STATE"),
    canDeleteAdjuntos: canEditSolicitud(
      user,
      solicitud,
      "DELETE_ATTACHMENT",
      fieldAccess,
    ),
    canDownloadAdjuntos: canEditSolicitud(
      user,
      solicitud,
      "DOWNLOAD_ATTACHMENT",
    ),
    canEdit: canEditSolicitud(user, solicitud, "EDIT_DATA"),
    canManageCancelaciones: canEditSolicitud(
      user,
      solicitud,
      "MANAGE_CANCELACIONES",
      fieldAccess,
    ),
    canUploadAdjuntos: canEditSolicitud(
      user,
      solicitud,
      "UPLOAD_ATTACHMENT",
      fieldAccess,
    ),
    canView: canViewSolicitud(user, solicitud),
    canViewHistory: canEditSolicitud(user, solicitud, "VIEW_HISTORY"),
  };
}

export function canManageSolicitudAttachments(input: {
  user: SolicitudPermissionUser;
  solicitud: SolicitudPermissionTarget;
  fieldAccess: Pick<
    SolicitudFieldAccessRuleRecord,
    "active" | "canManageAttachments" | "workflowStateId"
  > | null;
}) {
  if (input.user.isSystemAdmin) {
    return true;
  }

  return Boolean(
    isCurrentOwnerUser(input.user, input.solicitud) &&
      input.fieldAccess &&
      input.fieldAccess.active &&
      input.fieldAccess.canManageAttachments,
  );
}

function isCurrentOwnerUser(
  user: SolicitudPermissionUser,
  solicitud: SolicitudPermissionTarget,
) {
  return Boolean(
    user.workflowOwnerId &&
      solicitud.estadoActual.ownerId &&
      user.workflowOwnerId === solicitud.estadoActual.ownerId,
  );
}
