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
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuthSessionQuery } from "@/modules/auth/hooks/use-auth-session";
import {
  canCreateSocio,
  canDeleteSocio,
  canEditSocio,
  isVendedor,
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
import { ListaPaginacion } from "@/modules/solicitudes-core/components/lista-solicitudes-controles";
import { LISTA_HEADER_CELL } from "@/modules/solicitudes-core/utils/lista-solicitudes-formato";
import { SolicitudesContentLoader } from "@/modules/solicitudes-shared/components/solicitudes-content-loader";
import { Button } from "@/shared/components/ui/button";
import { ApiError } from "@/shared/services/http/api-error";
import { cn } from "@/shared/utils/cn";

const PAGE_SIZE = 30;

const BUSCADOR_ICONO =
  "pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-foreground-muted";
const BUSCADOR_INPUT =
  "h-10 w-full rounded-full border border-border bg-surface pr-4 pl-10 text-sm outline-none placeholder:text-foreground-muted focus:border-input-focus focus:ring-2 focus:ring-input-focus/20";
const BOTON_PRINCIPAL =
  "h-10 rounded-full bg-verde px-5 font-semibold text-white hover:bg-verde/90";
const ACCION_FILA =
  "inline-flex size-7 items-center justify-center rounded-full border border-border bg-surface text-foreground-secondary transition hover:border-verde hover:text-verde focus-visible:ring-2 focus-visible:ring-verde/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

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

// DNI (7 u 8 digitos) o CUIL/CUIT (11), sin separadores; null si no lo es.
function documentoCompleto(valor: string) {
  const digitos = valor.replace(/[.\-\s]/g, "");

  return /^(\d{7,8}|\d{11})$/.test(digitos) ? digitos : null;
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

function ListaVacia({
  titulo,
  children,
}: {
  titulo: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-full bg-verde/10 text-verde">
        <Users className="size-6" />
      </span>
      <p className="font-semibold text-foreground">{titulo}</p>
      {children}
    </div>
  );
}

export function SociosPage() {
  const queryClient = useQueryClient();
  const [dialogState, setDialogState] = useState<DialogState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);

  const sessionQuery = useAuthSessionQuery();
  const canCreateNewSocio = canCreateSocio(sessionQuery.data);
  const canEditExistingSocio = canEditSocio(sessionQuery.data);
  const canDeleteExistingSocio = canDeleteSocio(sessionQuery.data);
  const mostrarAcciones = canEditExistingSocio || canDeleteExistingSocio;
  // Un vendedor no ve el padron: busca un socio por DNI o CUIL/CUIT y ve
  // solo ese. El backend aplica la misma regla.
  const esVendedor = isVendedor(sessionQuery.data);
  const [documentoBuscado, setDocumentoBuscado] = useState<string | null>(null);
  const [documentoError, setDocumentoError] = useState<string | null>(null);

  const sociosQuery = useSociosQuery({
    // Hasta saber quien es el usuario no se pide nada: un vendedor nunca
    // tiene que llegar a pedir la lista completa.
    enabled:
      sessionQuery.isSuccess && (!esVendedor || documentoBuscado !== null),
    page,
    pageSize: PAGE_SIZE,
    search: esVendedor ? (documentoBuscado ?? undefined) : searchTerm,
  });
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

  function handleSearchChange(value: string) {
    setSearchTerm(value);

    if (!esVendedor) {
      setPage(1);
    }
  }

  function buscarDocumento() {
    const documento = documentoCompleto(searchTerm);

    if (!documento) {
      setDocumentoError(
        "Ingresá un DNI de 7 u 8 dígitos o un CUIL/CUIT de 11 dígitos.",
      );
      return;
    }

    setDocumentoError(null);
    setDocumentoBuscado(documento);
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
          : "No se pudieron actualizar los socios desde Vimarx.";

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
    <article className="flex h-full min-h-0 flex-col gap-3 p-2 md:p-4">
      <div className="flex flex-wrap items-center gap-2">
        {canCreateNewSocio ? (
          <Button
            className={BOTON_PRINCIPAL}
            disabled={isLoading || isMutating}
            onClick={openCreateDialog}
            type="button"
          >
            <Plus className="size-4" />
            Nuevo socio
          </Button>
        ) : null}
        {esVendedor ? null : (
          <Button
            className="h-10 rounded-full bg-surface px-4 text-foreground"
            disabled={isLoading || isMutating}
            onClick={() => setConfirmState({ type: "sync-vimax" })}
            type="button"
            variant="outline"
          >
            <RefreshCw
              className={cn(
                "size-4",
                syncSociosMutation.isPending && "animate-spin",
              )}
            />
            {syncSociosMutation.isPending
              ? "Actualizando desde Vimarx…"
              : "Actualizar desde Vimarx"}
          </Button>
        )}

        {esVendedor ? (
          <form
            className="ml-auto flex w-full flex-col gap-1 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault();
              buscarDocumento();
            }}
          >
            <div className="flex items-center gap-2">
              <label className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
                <span className="sr-only">DNI o CUIL/CUIT del socio</span>
                <Search className={BUSCADOR_ICONO} />
                <input
                  className={BUSCADOR_INPUT}
                  inputMode="numeric"
                  onChange={(event) => handleSearchChange(event.target.value)}
                  placeholder="DNI o CUIL/CUIT del socio"
                  value={searchTerm}
                />
              </label>
              <Button
                className={BOTON_PRINCIPAL}
                disabled={!searchTerm.trim()}
                type="submit"
              >
                Buscar
              </Button>
            </div>
            {documentoError ? (
              <p className="px-4 text-xs text-destructive">{documentoError}</p>
            ) : null}
          </form>
        ) : (
          <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
            <label className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
              <span className="sr-only">
                Buscar por nombre, razón social, DNI o CUIT
              </span>
              <Search className={BUSCADOR_ICONO} />
              <input
                className={BUSCADOR_INPUT}
                onChange={(event) => handleSearchChange(event.target.value)}
                placeholder="Buscar por nombre, DNI o CUIT"
                type="search"
                value={searchTerm}
              />
            </label>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-border bg-surface shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {esVendedor && documentoBuscado === null ? (
          <ListaVacia titulo="Ingresá el DNI o CUIL/CUIT del socio para ver sus datos" />
        ) : isLoading ? (
          <SolicitudesContentLoader />
        ) : hasLoadError ? (
          <ListaVacia titulo="No se pudieron cargar los socios">
            <Button
              className="rounded-full"
              onClick={() => void sociosQuery.refetch()}
              type="button"
              variant="outline"
            >
              Reintentar
            </Button>
          </ListaVacia>
        ) : socios.length === 0 ? (
          <ListaVacia
            titulo={
              esVendedor
                ? "No encontramos un socio con ese DNI o CUIL/CUIT"
                : searchTerm.trim()
                  ? "No hay socios que coincidan con la búsqueda"
                  : "No hay socios para mostrar"
            }
          />
        ) : (
          <table className="w-full min-w-[46rem] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className={LISTA_HEADER_CELL}>Socio</th>
                <th className={LISTA_HEADER_CELL}>CUIT</th>
                <th className={LISTA_HEADER_CELL}>Nacimiento</th>
                <th className={LISTA_HEADER_CELL}>Contacto</th>
                {mostrarAcciones ? (
                  <th className={LISTA_HEADER_CELL}>
                    <span className="sr-only">Acciones</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {socios.map((socio) => (
                <tr
                  className="transition-colors hover:bg-verde/5 [&>td]:border-t [&>td]:border-border-soft [&:last-child>td]:border-b"
                  key={socio.id}
                >
                  <td className="min-w-48 px-3 py-2.5">
                    <p className="font-semibold text-foreground">
                      {getSocioDisplayName(socio) || "Sin nombre"}
                    </p>
                    <p className="text-xs text-foreground-secondary tabular-nums">
                      {socio.tipoPersona === "FISICA"
                        ? `${socio.tipoDocumento} ${socio.nroDocumento}`
                        : "Persona jurídica"}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-foreground-secondary tabular-nums">
                    {socio.cuit || "—"}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-foreground-secondary tabular-nums">
                    {socio.tipoPersona === "FISICA" && socio.fechaDeNacimiento
                      ? formatCivilDate(socio.fechaDeNacimiento)
                      : "—"}
                  </td>
                  <td className="max-w-64 px-3 py-2.5">
                    {socio.celular || socio.email ? (
                      <>
                        {socio.celular ? (
                          <p className="text-foreground tabular-nums">
                            {socio.celular}
                          </p>
                        ) : null}
                        {socio.email ? (
                          <p
                            className="truncate text-xs text-foreground-secondary"
                            title={socio.email}
                          >
                            {socio.email}
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-foreground-muted">—</span>
                    )}
                  </td>
                  {mostrarAcciones ? (
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {canEditExistingSocio ? (
                          <button
                            aria-label={`Editar a ${getSocioDisplayName(socio)}`}
                            className={ACCION_FILA}
                            disabled={isMutating}
                            onClick={() => openEditDialog(socio)}
                            title="Editar"
                            type="button"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        ) : null}
                        {canDeleteExistingSocio ? (
                          <button
                            aria-label={`Eliminar a ${getSocioDisplayName(socio)}`}
                            className={cn(
                              ACCION_FILA,
                              "hover:border-destructive hover:text-destructive",
                            )}
                            disabled={isMutating}
                            onClick={() =>
                              setConfirmState({ type: "delete-socio", socio })
                            }
                            title="Eliminar"
                            type="button"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {esVendedor ? null : (
        <ListaPaginacion
          nombres={{ singular: "socio", plural: "socios" }}
          onPageChange={setPage}
          page={page}
          pageSize={PAGE_SIZE}
          rowsCount={socios.length}
          total={totalItems}
        />
      )}

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
            : "Puede tardar varios minutos. No cierres esta pestaña mientras se ejecuta."
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
            : "Actualizar desde Vimarx"
        }
        variant={
          confirmState?.type === "delete-socio" ? "destructive" : "default"
        }
      />
    </article>
  );
}
