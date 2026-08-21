import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  CircleCheckBig,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuthSessionQuery } from "@/modules/auth/hooks/use-auth-session";
import {
  canCreateSocio,
  canDeleteSocio,
  canEditSocio,
} from "@/modules/auth/utils/auth-user";
import { SocioFormDialog } from "@/modules/socios/components/socio-form-dialog";
import { ConfirmDialog } from "@/shared/components/ui/confirm-dialog";
import { Progress } from "@/shared/components/ui/progress";
import { useSociosQuery } from "@/modules/socios/hooks/use-socios-query";
import {
  createSocio,
  deleteSocio,
  syncSociosFromLegacy,
  updateSocio,
} from "@/modules/socios/services/socios-api";
import type {
  CreateSocioRequest,
  Socio,
  UpdateSocioRequest,
} from "@/modules/socios/types";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { SolicitudesTablePagination } from "@/modules/solicitudes-shared/components/solicitudes-table-pagination";
import { TableEmptyState } from "@/shared/components/ui/table-empty-state";
import { TableLoader } from "@/shared/components/ui/table-loader";
import { ApiError } from "@/shared/services/http/api-error";

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50];

type DialogState =
  | {
      mode: "create";
      socio: null;
    }
  | {
      mode: "edit";
      socio: Socio;
    };

type ConfirmState =
  | { type: "delete-socio"; socio: Socio }
  | { type: "sync-vimax" };

function getSocioDisplayName(socio: Socio) {
  return socio.tipoPersona === "FISICA"
    ? `${socio.apellido} ${socio.nombre}`.trim()
    : socio.razonSocial;
}

function getSocioTypeLabel(socio: Socio) {
  return socio.tipoPersona === "FISICA" ? "Persona física" : "Persona jurídica";
}

function formatElapsedTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatCivilDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return value;
  }

  const parsed = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
}

export function SociosPage() {
  const queryClient = useQueryClient();
  const [dialogState, setDialogState] = useState<DialogState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const sessionQuery = useAuthSessionQuery();
  const canCreateNewSocio = canCreateSocio(sessionQuery.data);
  const canEditExistingSocio = canEditSocio(sessionQuery.data);
  const canDeleteExistingSocio = canDeleteSocio(sessionQuery.data);

  const sociosQuery = useSociosQuery({ page, pageSize, search: searchTerm });
  const createSocioMutation = useMutation({
    mutationFn: (payload: CreateSocioRequest) => createSocio(payload),
  });
  const updateSocioMutation = useMutation({
    mutationFn: ({
      payload,
      socioId,
    }: {
      payload: UpdateSocioRequest;
      socioId: string;
    }) => updateSocio(socioId, payload),
  });
  const deleteSocioMutation = useMutation({
    mutationFn: (socioId: string) => deleteSocio(socioId),
  });
  const syncSociosMutation = useMutation({
    mutationFn: syncSociosFromLegacy,
  });
  const [syncElapsedSeconds, setSyncElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!syncSociosMutation.isPending) {
      return;
    }

    const intervalId = setInterval(() => {
      setSyncElapsedSeconds((previous) => previous + 1);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [syncSociosMutation.isPending]);

  const socios = sociosQuery.data?.items ?? [];
  const totalItems = sociosQuery.data?.total ?? 0;
  const isLoading = sociosQuery.isLoading;
  const hasLoadError = sociosQuery.isError;
  const isMutating =
    createSocioMutation.isPending ||
    updateSocioMutation.isPending ||
    deleteSocioMutation.isPending ||
    syncSociosMutation.isPending;

  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));

  function handleSearchChange(value: string) {
    setSearchTerm(value);
    setPage(1);
  }

  function openCreateDialog() {
    setDialogState({
      mode: "create",
      socio: null,
    });
  }

  function openEditDialog(socio: Socio) {
    setDialogState({
      mode: "edit",
      socio,
    });
  }

  async function performDeleteSocio(socio: Socio) {
    try {
      await deleteSocioMutation.mutateAsync(socio.id);
      await queryClient.invalidateQueries({ queryKey: ["socios"] });
      setConfirmState(null);
      toast.success("Socio eliminado correctamente.", {
        duration: 3000,
        icon: <CircleCheckBig className="size-5" />,
      });
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "No se pudo eliminar el socio.";

      toast.error(message, {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
      });
    }
  }

  async function performSyncSociosFromLegacy() {
    try {
      setSyncElapsedSeconds(0);
      const summary = await syncSociosMutation.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ["socios"] });
      setConfirmState(null);
      toast.success(`Listo: ${summary.upserted} socios actualizados.`, {
        duration: 4500,
        icon: <CircleCheckBig className="size-5" />,
      });
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "No se pudo actualizar los socios desde Vimax.";

      toast.error(message, {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
      });
    }
  }

  function handleConfirm() {
    if (!confirmState) {
      return;
    }

    if (confirmState.type === "delete-socio") {
      void performDeleteSocio(confirmState.socio);
    } else {
      void performSyncSociosFromLegacy();
    }
  }

  async function handleSubmitSocio(
    payload: CreateSocioRequest | UpdateSocioRequest,
  ) {
    if (!dialogState) {
      return;
    }

    if (dialogState.mode === "create") {
      await createSocioMutation.mutateAsync(payload as CreateSocioRequest);
    } else {
      await updateSocioMutation.mutateAsync({
        payload: payload as UpdateSocioRequest,
        socioId: dialogState.socio.id,
      });
    }

    await queryClient.invalidateQueries({ queryKey: ["socios"] });
    setDialogState(null);
    toast.success("Socio guardado correctamente.", {
      duration: 3000,
      icon: <CircleCheckBig className="size-5" />,
    });
  }

  return (
    <article className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-sm">
      <header className="border-b border-border px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="inline-flex size-12 items-center justify-center rounded-full bg-primary/12 text-primary">
              <Users className="size-6" />
            </div>
            <div className="space-y-1">
              <h1 className="text-[1.85rem] leading-none font-semibold text-foreground">
                Socios
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-foreground-secondary">
                Administra personas físicas y jurídicas desde esta pantalla.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={isLoading || isMutating}
              onClick={() => setConfirmState({ type: "sync-vimax" })}
              type="button"
              variant="outline"
            >
              <RefreshCw className="size-4" />
              {syncSociosMutation.isPending
                ? "Actualizando... (puede tardar unos minutos)"
                : "Actualizar desde Vimax"}
            </Button>
            {canCreateNewSocio ? (
              <Button
                disabled={isLoading || isMutating}
                onClick={openCreateDialog}
                type="button"
              >
                <Plus className="size-4" />
                Nuevo socio
              </Button>
            ) : null}
          </div>
        </div>

        <div className="relative mt-3 max-w-sm">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-foreground-muted" />
          <Input
            className="pl-8"
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Buscar por nombre, razón social o DNI/CUIT..."
            value={searchTerm}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3 md:p-4">
        {isLoading ? (
          <TableLoader className="min-h-[240px]" label="Cargando socios..." />
        ) : hasLoadError ? (
          <div className="flex flex-col items-start gap-3 rounded-md border border-border bg-background p-4">
            <p className="text-sm text-destructive">
              No se pudieron cargar los socios.
            </p>
            <Button
              onClick={() => void sociosQuery.refetch()}
              size="sm"
              type="button"
              variant="outline"
            >
              Reintentar
            </Button>
          </div>
        ) : socios.length === 0 ? (
          <TableEmptyState message="No hay socios para mostrar." />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-background">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-foreground-secondary">
                    Tipo
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-secondary">
                    CUIT
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-secondary">
                    Nombre / razón social
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-secondary">
                    Documento
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-secondary">
                    Fecha nacimiento
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-secondary">
                    Email
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-secondary">
                    Celular
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-secondary">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {socios.map((socio) => (
                  <tr className="bg-surface" key={socio.id}>
                    <td className="px-3 py-2 text-foreground">
                      {getSocioTypeLabel(socio)}
                    </td>
                    <td className="px-3 py-2 text-foreground">{socio.cuit}</td>
                    <td className="px-3 py-2 text-foreground">
                      {getSocioDisplayName(socio)}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {socio.tipoPersona === "FISICA"
                        ? `${socio.tipoDocumento} ${socio.nroDocumento}`
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {socio.tipoPersona === "FISICA"
                        ? formatCivilDate(socio.fechaDeNacimiento)
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {socio.email ?? "-"}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {socio.celular ?? "-"}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      <div className="flex flex-wrap gap-2">
                        {canEditExistingSocio ? (
                          <Button
                            disabled={isMutating}
                            onClick={() => openEditDialog(socio)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <Pencil className="size-3.5" />
                            Editar
                          </Button>
                        ) : null}
                        {canDeleteExistingSocio ? (
                          <Button
                            disabled={isMutating}
                            onClick={() =>
                              setConfirmState({ type: "delete-socio", socio })
                            }
                            size="sm"
                            type="button"
                            variant="destructive"
                          >
                            <Trash2 className="size-3.5" />
                            Eliminar
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SolicitudesTablePagination
        currentPage={page}
        itemLabel="socios"
        onPageChange={setPage}
        onPageSizeChange={(nextPageSize) => {
          setPageSize(nextPageSize);
          setPage(1);
        }}
        pageCount={pageCount}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        totalItems={totalItems}
      />

      <SocioFormDialog
        isSaving={
          createSocioMutation.isPending || updateSocioMutation.isPending
        }
        onOpenChange={(open) => {
          if (!open) {
            setDialogState(null);
          }
        }}
        onSubmit={handleSubmitSocio}
        open={dialogState !== null}
        socio={dialogState?.socio ?? null}
      />

      <ConfirmDialog
        confirmLabel={
          confirmState?.type === "delete-socio" ? "Eliminar" : "Actualizar"
        }
        description={
          confirmState?.type === "delete-socio"
            ? `Vas a eliminar a ${getSocioDisplayName(confirmState.socio)}. ¿Querés continuar?`
            : "Puede tardar varios minutos, no cierres esta pestaña mientras se ejecuta."
        }
        isConfirming={
          confirmState?.type === "delete-socio"
            ? deleteSocioMutation.isPending
            : syncSociosMutation.isPending
        }
        onConfirm={handleConfirm}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmState(null);
          }
        }}
        open={confirmState !== null}
        progress={
          confirmState?.type === "sync-vimax" ? (
            <div className="space-y-2">
              <Progress value={null} />
              <p className="text-xs text-foreground-muted">
                Tiempo transcurrido: {formatElapsedTime(syncElapsedSeconds)}
              </p>
            </div>
          ) : undefined
        }
        title={
          confirmState?.type === "delete-socio"
            ? "Eliminar socio"
            : "Actualizar desde Vimax"
        }
        variant={
          confirmState?.type === "delete-socio" ? "destructive" : "default"
        }
      />
    </article>
  );
}
