import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheckBig, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { WorkflowAreaSelector } from "@/modules/users-admin/components/workflow-area-selector";
import {
  assignWorkflowOwners,
  getPendingAreaUsers,
  getWorkflowOwners,
} from "@/modules/users-admin/services/users-admin-api";
import { Button } from "@/shared/components/ui/button";
import { ApiError } from "@/shared/services/http/api-error";

const ASSIGN_SUCCESS_TOAST_ID = "assign-workflow-owner-success";
const ASSIGN_ERROR_TOAST_ID = "assign-workflow-owner-error";
export function AdminUsersPendingPage() {
  const [selectedByUserId, setSelectedByUserId] = useState<
    Record<string, string[]>
  >({});
  const pendingUsersQuery = useQuery({
    queryFn: getPendingAreaUsers,
    queryKey: ["users-admin", "pending-area-users"],
    retry: false,
  });
  const workflowOwnersQuery = useQuery({
    queryFn: getWorkflowOwners,
    queryKey: ["users-admin", "workflow-owners"],
    retry: false,
  });
  const assignMutation = useMutation({
    mutationFn: ({
      userId,
      workflowOwnerIds,
    }: {
      userId: string;
      workflowOwnerIds: string[];
    }) => assignWorkflowOwners(userId, workflowOwnerIds),
  });

  const users = pendingUsersQuery.data?.users ?? [];
  const workflowOwners = (
    workflowOwnersQuery.data?.workflowOwners ?? []
  ).filter((owner) => !["SISTEMA", "HISTORIAL"].includes(owner.code));
  const isLoading =
    pendingUsersQuery.isLoading || workflowOwnersQuery.isLoading;
  const hasLoadError = pendingUsersQuery.isError || workflowOwnersQuery.isError;

  async function onAssignArea(userId: string) {
    const workflowOwnerIds = selectedByUserId[userId];

    if (!workflowOwnerIds?.length) {
      toast.error("Seleccioná al menos un área.", {
        duration: 3000,
        icon: <CircleAlert className="size-5" />,
        id: ASSIGN_ERROR_TOAST_ID,
      });
      return;
    }

    toast.dismiss(ASSIGN_SUCCESS_TOAST_ID);
    toast.dismiss(ASSIGN_ERROR_TOAST_ID);

    try {
      await assignMutation.mutateAsync({ userId, workflowOwnerIds });
      await pendingUsersQuery.refetch();
      setSelectedByUserId((current) => {
        const next = { ...current };
        delete next[userId];
        return next;
      });
      toast.success("Áreas asignadas correctamente.", {
        duration: 3000,
        icon: <CircleCheckBig className="size-5" />,
        id: ASSIGN_SUCCESS_TOAST_ID,
      });
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "No se pudieron asignar las áreas.";

      toast.error(message, {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
        id: ASSIGN_ERROR_TOAST_ID,
      });
    }
  }

  return (
    <article className="flex h-full min-h-[24rem] flex-col overflow-hidden rounded-md border border-border bg-surface shadow-sm">
      <header className="border-b border-border px-4 py-3">
        <h1 className="text-[1.85rem] leading-none font-semibold text-foreground">
          Usuarios pendientes
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3 md:p-4">
        {isLoading ? (
          <div className="flex min-h-[14rem] items-center justify-center">
            <p className="text-sm text-foreground-secondary">
              Cargando usuarios...
            </p>
          </div>
        ) : hasLoadError ? (
          <div className="flex min-h-[14rem] items-center justify-center px-6 text-center">
            <div className="max-w-sm space-y-3">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-foreground/5 text-foreground-secondary">
                <Users className="size-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-foreground">
                  No se pudieron cargar los usuarios pendientes
                </h2>
                <p className="text-sm text-foreground-secondary">
                  No fue posible obtener la lista en este momento.
                </p>
              </div>
            </div>
          </div>
        ) : users.length === 0 ? (
          <div className="flex min-h-[20rem] items-center justify-center px-6 py-10 text-center">
            <div className="max-w-sm space-y-5">
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
                <Users className="size-6" />
              </div>
              <div className="space-y-2">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">
                  No hay usuarios pendientes
                </h2>
                <p className="text-sm leading-6 text-foreground-secondary">
                  {
                    "No hay usuarios pendientes de asignaci\u00f3n en este momento."
                  }
                </p>
              </div>
              <Button
                onClick={() => void pendingUsersQuery.refetch()}
                type="button"
                variant="secondary"
              >
                Recargar
              </Button>
            </div>
          </div>
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
                    Áreas
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-secondary">
                    {"Acci\u00f3n"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((user) => {
                  const selectedWorkflowOwnerIds =
                    selectedByUserId[user.id] ?? [];
                  const isAssigning =
                    assignMutation.isPending &&
                    assignMutation.variables?.userId === user.id;

                  return (
                    <tr className="bg-surface" key={user.id}>
                      <td className="px-3 py-2 text-foreground">
                        {user.email}
                      </td>
                      <td className="px-3 py-2 text-foreground">
                        {[user.firstName, user.lastName]
                          .filter(Boolean)
                          .join(" ") || "-"}
                      </td>
                      <td className="px-3 py-2 text-foreground">
                        {user.legacyUser || "-"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="min-w-56">
                          <WorkflowAreaSelector
                            disabled={isAssigning}
                            onChange={(value) =>
                              setSelectedByUserId((current) => ({
                                ...current,
                                [user.id]: value,
                              }))
                            }
                            owners={workflowOwners}
                            selected={selectedWorkflowOwnerIds}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          disabled={
                            isAssigning || !selectedWorkflowOwnerIds.length
                          }
                          onClick={() => void onAssignArea(user.id)}
                          type="button"
                        >
                          {isAssigning ? "Asignando..." : "Asignar áreas"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </article>
  );
}
