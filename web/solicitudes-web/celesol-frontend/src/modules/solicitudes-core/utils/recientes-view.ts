import type { AuthUser } from "@/modules/auth/services/auth-api";
import type { ListSolicitudesCoreQuery } from "@/modules/solicitudes/types/solicitudes-core";

export type RecientesView = NonNullable<ListSolicitudesCoreQuery["vista"]>;
type Profile = Pick<
  AuthUser,
  "isSystemAdmin" | "workflowOwner" | "workflowOwnerId"
>;

export function isRecientesVendedor(user: Profile) {
  return !user.isSystemAdmin && user.workflowOwner?.code === "VENDEDORES";
}

export function initialRecientesView(user: Profile): RecientesView {
  if (isRecientesVendedor(user)) return "vendedores";
  return !user.isSystemAdmin &&
    user.workflowOwnerId &&
    user.workflowOwner?.code === "RIESGO"
    ? "mi-area"
    : "todas";
}

// Otros perfiles conservan su selector y su vista inicial vigente.
export function recientesViews(
  user: Profile,
): { value: RecientesView; label: string }[] {
  if (isRecientesVendedor(user))
    return [
      { value: "vendedores", label: "Vendedores" },
      { value: "analistas", label: "Analistas" },
      { value: "todas", label: "Todas" },
    ];
  return [
    {
      value: "mi-area",
      label:
        user.workflowOwner?.code === "RIESGO"
          ? "Riesgo"
          : (user.workflowOwner?.name ?? "Sin área asignada"),
    },
    { value: "todas", label: "Ver todas" },
  ];
}
