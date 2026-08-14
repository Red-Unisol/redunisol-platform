import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheckBig } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AdminUserEditDialog,
  type AdminUserEditSubmission,
} from "@/modules/users-admin/components/admin-user-edit-dialog";
import {
  assignWorkflowOwner,
  getUsers,
  getWorkflowOwners,
  type UpdateAdminUserRequest,
  type UsersAdminUser,
  updateUser,
} from "@/modules/users-admin/services/users-admin-api";
import { Button } from "@/shared/components/ui/button";
import { ApiError } from "@/shared/services/http/api-error";

class PartialAreaUpdateError extends Error {}

function getUserStateLabel(state: number) {
  if (state === 0) {
    return "Inactivo";
  }

  if (state === 1) {
    return "Activo";
  }

  if (state === 2) {
    return "Pendiente de área";
  }

  return "Desconocido";
}

export function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [editingUser, setEditingUser] = useState<UsersAdminUser | null>(null);
  const usersQuery = useQuery({
    queryFn: getUsers,
    queryKey: ["users-admin", "users"],
    retry: false,
  });
  const workflowOwnersQuery = useQuery({
    queryFn: getWorkflowOwners,
    queryKey: ["users-admin", "workflow-owners"],
    retry: false,
  });
  const updateUserMutation = useMutation({
    mutationFn: ({
      payload,
      userId,
    }: {
      payload: UpdateAdminUserRequest;
      userId: string;
    }) => updateUser(userId, payload),
  });
  const assignWorkflowOwnerMutation = useMutation({
    mutationFn: ({
      userId,
      workflowOwnerId,
    }: {
      userId: string;
      workflowOwnerId: string | null;
    }) => assignWorkflowOwner(userId, workflowOwnerId),
  });

  const users = usersQuery.data?.users ?? [];
  const workflowOwners = workflowOwnersQuery.data?.workflowOwners ?? [];
  const workflowOwnersById = new Map(
    workflowOwners.map((owner) => [owner.id, owner.name]),
  );
  const workflowOwnerOptions = workflowOwners.map((owner) => ({
    label: owner.name,
    value: owner.id,
  }));
  const isLoading = usersQuery.isLoading || workflowOwnersQuery.isLoading;
  const hasLoadError = usersQuery.isError || workflowOwnersQuery.isError;

  async function handleSubmitUserUpdate({
    areaChanged,
    nextWorkflowOwnerId,
    userPayload,
  }: AdminUserEditSubmission) {
    if (!editingUser) {
      return;
    }

    if (
      userPayload.isSystemAdmin === false &&
      editingUser.isSystemAdmin &&
      !window.confirm(
        "Vas a quitar permisos de admin del sistema. ¿Querés continuar?",
      )
    ) {
      return;
    }

    if (
      userPayload.state === 0 &&
      editingUser.state !== 0 &&
      !window.confirm("Vas a desactivar este usuario. ¿Querés continuar?")
    ) {
      return;
    }

    if (
      userPayload.legacyUser !== undefined &&
      !window.confirm(
        "Vas a cambiar el usuario legacy. Este dato es sensible porque puede afectar login/identidad legacy. ¿Querés continuar?",
      )
    ) {
      return;
    }

    const hasUserChanges = Object.keys(userPayload).length > 0;
    const shouldUpdateArea = areaChanged;

    try {
      if (hasUserChanges) {
        await updateUserMutation.mutateAsync({
          payload: userPayload,
          userId: editingUser.id,
        });
      }

      if (shouldUpdateArea) {
        try {
          await assignWorkflowOwnerMutation.mutateAsync({
            userId: editingUser.id,
            workflowOwnerId: nextWorkflowOwnerId,
          });
        } catch (error) {
          await queryClient.invalidateQueries({
            queryKey: ["users-admin", "users"],
          });

          const detailMessage =
            error instanceof ApiError || error instanceof Error
              ? error.message
              : "No se pudo actualizar el área.";

          toast.error(
            `Se guardaron los datos del usuario, pero falló la actualización de área. ${detailMessage}`,
            {
              duration: 3500,
              icon: <CircleAlert className="size-5" />,
            },
          );

          throw new PartialAreaUpdateError(detailMessage);
        }
      }

      await queryClient.invalidateQueries({
        queryKey: ["users-admin", "users"],
      });
      setEditingUser(null);
      toast.success("Usuario actualizado correctamente.", {
        duration: 3000,
        icon: <CircleCheckBig className="size-5" />,
      });
    } catch (error) {
      if (error instanceof PartialAreaUpdateError) {
        throw error;
      }

      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "No se pudo actualizar el usuario.";

      toast.error(message, {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
      });
      throw new Error(message);
    }
  }

  return (
    <article className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-sm">
      <header className="border-b border-border px-4 py-3">
        <h1 className="text-[1.85rem] leading-none font-semibold text-foreground">
          Usuarios
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3 md:p-4">
        {isLoading ? (
          <p className="text-sm text-foreground-secondary">
            Cargando usuarios...
          </p>
        ) : hasLoadError ? (
          <p className="text-sm text-destructive">
            No se pudieron cargar los usuarios.
          </p>
        ) : users.length === 0 ? (
          <p className="text-sm text-foreground-secondary">
            No hay usuarios para mostrar.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-background">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-foreground-secondary">
                    Email
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-secondary">
                    Nombre
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-secondary">
                    Usuario legacy
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-secondary">
                    Email verificado
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-secondary">
                    Estado
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-secondary">
                    Área
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-secondary">
                    Admin sistema
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-secondary">
                    Acción
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((user) => (
                  <tr className="bg-surface" key={user.id}>
                    <td className="px-3 py-2 text-foreground">{user.email}</td>
                    <td className="px-3 py-2 text-foreground">
                      {[user.firstName, user.lastName]
                        .filter(Boolean)
                        .join(" ") || "-"}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {user.legacyUser || "-"}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {user.emailVerified ? "Sí" : "No"}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {getUserStateLabel(user.state)}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {user.workflowOwnerId
                        ? (workflowOwnersById.get(user.workflowOwnerId) ??
                          user.workflowOwnerId)
                        : "Sin área"}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {user.isSystemAdmin ? "Sí" : "No"}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      <Button
                        onClick={() => setEditingUser(user)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Editar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AdminUserEditDialog
        isSubmitting={
          updateUserMutation.isPending || assignWorkflowOwnerMutation.isPending
        }
        onOpenChange={(open) => {
          if (!open) {
            setEditingUser(null);
          }
        }}
        onSubmit={handleSubmitUserUpdate}
        open={editingUser !== null}
        user={editingUser}
        workflowOwnerOptions={workflowOwnerOptions}
      />
    </article>
  );
}
