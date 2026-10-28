import {
  type CSSProperties,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Calculator,
  CircleAlert,
  CircleCheckBig,
  ClipboardList,
  Paperclip,
  Plus,
  Send,
} from "lucide-react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { useAuthSessionQuery } from "@/modules/auth/hooks/use-auth-session";
import { canCreateSolicitud } from "@/modules/auth/utils/auth-user";
import { useLineasDelAgenteQuery } from "@/modules/solicitudes-core/hooks/use-lineas-del-agente-query";
import {
  ActualizarListaButton,
  ListaPaginacion,
} from "@/modules/solicitudes-core/components/lista-solicitudes-controles";
import { useSolicitudesCorePrecargaQuery } from "@/modules/solicitudes-core/hooks/use-solicitudes-core-precarga-query";
import {
  executeSolicitudCoreTransition,
  listSolicitudCoreAdjuntos,
  listSolicitudCoreTransitions,
  uploadSolicitudCoreAdjuntosLote,
} from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";
import {
  resolveListRefreshState,
  runListManualRefresh,
} from "@/modules/solicitudes-core/utils/list-refresh-state";
import {
  LISTA_HEADER_CELL as HEADER_CELL,
  buildRowStyleLista,
  buildSocioLista,
  formatFechaLista,
  formatMontoLista,
} from "@/modules/solicitudes-core/utils/lista-solicitudes-formato";
import { getRecibosDeSolicitud } from "@/modules/solicitudes-core/utils/recibos-de-solicitud";
import {
  AdjuntosLoteModal,
  type AdjuntoLoteItem,
} from "@/modules/solicitudes-editor/components/AdjuntosLoteModal";
import { SolicitudesContentLoader } from "@/modules/solicitudes-shared/components/solicitudes-content-loader";
import { loadSimuladorPrestamoModal } from "@/modules/solicitudes-shared/utils/load-simulador-prestamo-modal";
import { prefetchWhenIdle } from "@/modules/solicitudes-shared/utils/prefetch-when-idle";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDialog } from "@/shared/components/ui/confirm-dialog";
import { ApiError } from "@/shared/services/http/api-error";

const SimuladorPrestamoModal = lazy(() =>
  loadSimuladorPrestamoModal().then((module) => ({
    default: module.SimuladorPrestamoModal,
  })),
);

const PAGE_SIZE = 30;
// Lo único que exige el backend para enviar a Riesgo es un recibo de sueldo adjunto.
const TIPO_RECIBO_SUELDO = "Recibo de Sueldo";
const ENVIAR_ACTION_CODE = "enviar";

type PrecargaRow = {
  cuotaResultante: string;
  cuotas: string;
  dni: string;
  fecha: string;
  id: string;
  linea: string;
  monto: string;
  rowStyle?: CSSProperties;
  socio: string;
  vendedor: string;
};

type EstadoParaEnviar = "revisando" | "falta-recibo" | "lista" | "desconocido";

export function SolicitudesActualPrecargaPage() {
  const navigate = useNavigate();
  const sessionQuery = useAuthSessionQuery();
  const canCreateNewSolicitud = canCreateSolicitud(sessionQuery.data);
  const [page, setPage] = useState(1);
  const [isManualRefreshPending, setIsManualRefreshPending] = useState(false);
  const [isSimuladorOpen, setIsSimuladorOpen] = useState(false);
  const isRefreshPendingRef = useRef(false);
  const queryClient = useQueryClient();
  const [reciboPara, setReciboPara] = useState<PrecargaRow | null>(null);
  const [isUploadingRecibo, setIsUploadingRecibo] = useState(false);
  const [envioPara, setEnvioPara] = useState<PrecargaRow | null>(null);
  const [comentarioEnvio, setComentarioEnvio] = useState<string | null>(null);
  const [isEnviando, setIsEnviando] = useState(false);
  // Las transiciones se piden al abrir la confirmación: dicen si "enviar" está disponible y si pide comentario.
  const transicionesQuery = useQuery({
    enabled: envioPara !== null,
    queryFn: () => listSolicitudCoreTransitions(envioPara?.id ?? ""),
    queryKey: solicitudesCoreQueryKeys.transitions(envioPara?.id ?? ""),
    retry: false,
  });
  const transicionEnviar =
    transicionesQuery.data?.find(
      (transition) => transition.actionCode === ENVIAR_ACTION_CODE,
    ) ?? null;
  const comentarioEnvioValue =
    comentarioEnvio ?? transicionEnviar?.defaultComment ?? "";
  const faltaComentarioEnvio =
    transicionEnviar?.requiresComment === true &&
    comentarioEnvioValue.trim().length === 0;
  const lineasQuery = useLineasDelAgenteQuery(isSimuladorOpen);
  useEffect(() => prefetchWhenIdle(loadSimuladorPrestamoModal), []);
  const { data, error, isFetching, isLoading, refetch } =
    useSolicitudesCorePrecargaQuery({
      page,
      pageSize: PAGE_SIZE,
    });

  const rows = useMemo<PrecargaRow[]>(
    () =>
      (data ?? []).map((item) => ({
        cuotaResultante: formatMontoLista(item.cuotaResultante),
        cuotas: item.cuotas !== null ? String(item.cuotas) : "",
        dni: item.titular.nroDocumento ?? "",
        fecha: formatFechaLista(item.createdAt),
        id: item.id,
        linea: item.lineaPrestamoDescripcion ?? "",
        monto: formatMontoLista(item.montoAFinanciar),
        rowStyle: buildRowStyleLista(item.appearance),
        socio: buildSocioLista(
          item.titular.apellidoDenominacion,
          item.titular.nombre,
        ),
        vendedor: item.vendedorSolicitud ?? "",
      })),
    [data],
  );

  // TODO backend: que la lista traiga si tiene recibo; por ahora una consulta de adjuntos por fila.
  const adjuntosQueries = useQueries({
    queries: rows.map((row) => ({
      queryFn: () => listSolicitudCoreAdjuntos(row.id),
      queryKey: solicitudesCoreQueryKeys.adjuntos(row.id),
      retry: false,
    })),
  });
  const estadoParaEnviar = new Map<string, EstadoParaEnviar>(
    rows.map((row, index): [string, EstadoParaEnviar] => {
      const query = adjuntosQueries[index];
      if (!query || query.isPending) return [row.id, "revisando"];
      if (query.isError) return [row.id, "desconocido"];
      return [
        row.id,
        getRecibosDeSolicitud(query.data, row.id).length > 0
          ? "lista"
          : "falta-recibo",
      ];
    }),
  );

  // La columna Vendedor solo aporta si en la lista hay más de uno.
  const showVendedor = new Set(rows.map((row) => row.vendedor)).size > 1;
  const refreshState = resolveListRefreshState({
    hasData: data !== undefined,
    isFetching,
    isLoading,
    isManualRefreshPending,
  });

  async function handleRefresh() {
    await runListManualRefresh({
      isRefreshActionDisabled: refreshState.isRefreshActionDisabled,
      isRefreshPendingRef,
      refetch,
      setIsManualRefreshPending,
    });
  }

  async function handleCargarRecibo(items: AdjuntoLoteItem[]) {
    if (!reciboPara) return false;
    const solicitudId = reciboPara.id;
    setIsUploadingRecibo(true);

    try {
      await uploadSolicitudCoreAdjuntosLote(solicitudId, items);
      await queryClient.invalidateQueries({
        queryKey: solicitudesCoreQueryKeys.adjuntos(solicitudId),
      });
      toast.success(
        items.length === 1
          ? "Recibo cargado."
          : `${items.length} adjuntos cargados.`,
        { duration: 3500, icon: <CircleCheckBig className="size-5" /> },
      );
      setReciboPara(null);
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar los adjuntos.",
        { duration: 3500, icon: <CircleAlert className="size-5" /> },
      );
      return false;
    } finally {
      setIsUploadingRecibo(false);
    }
  }

  function abrirEnvio(row: PrecargaRow) {
    setComentarioEnvio(null);
    setEnvioPara(row);
  }

  async function handleEnviar() {
    if (!envioPara || !transicionEnviar) return;
    const solicitudId = envioPara.id;
    const comentario = comentarioEnvioValue.trim();
    setIsEnviando(true);

    try {
      await executeSolicitudCoreTransition(solicitudId, {
        actionCode: ENVIAR_ACTION_CODE,
        ...(comentario ? { comment: comentario } : {}),
      });
      toast.success(
        `Solicitud de ${envioPara.socio || "el socio"} enviada a Riesgo.`,
        { duration: 3500, icon: <CircleCheckBig className="size-5" /> },
      );
      setEnvioPara(null);
      await Promise.all(
        [
          solicitudesCoreQueryKeys.precargaAll,
          solicitudesCoreQueryKeys.recientesAll,
          solicitudesCoreQueryKeys.detail(solicitudId),
          solicitudesCoreQueryKeys.transitions(solicitudId),
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.status === 403
          ? "No tenés permisos para enviar esta solicitud."
          : error instanceof Error
            ? error.message
            : "No se pudo enviar la solicitud.",
        { duration: 3500, icon: <CircleAlert className="size-5" /> },
      );
    } finally {
      setIsEnviando(false);
    }
  }

  function abrirDetalle(id: string) {
    navigate(`/solicitudes/core/detalle/${id}?origen=precarga`);
  }

  return (
    <article
      aria-busy={refreshState.isBackgroundRefreshing}
      className="flex h-full min-h-0 flex-col gap-3 p-2 md:p-4"
    >
      {/* Acción principal primero (a la izquierda); actualizar queda como utilidad a la derecha. */}
      <div className="flex flex-wrap items-center gap-2">
        {canCreateNewSolicitud ? (
          <Button
            className="h-10 rounded-full bg-verde px-5 font-semibold text-white hover:bg-verde/90"
            onClick={() => navigate("/solicitudes/core/precarga/nueva")}
            type="button"
          >
            <Plus className="size-4" />
            Nueva solicitud
          </Button>
        ) : null}
        <Button
          className="h-10 rounded-full bg-surface px-4 text-foreground"
          onClick={() => setIsSimuladorOpen(true)}
          onFocus={loadSimuladorPrestamoModal}
          onMouseEnter={loadSimuladorPrestamoModal}
          type="button"
          variant="outline"
        >
          <Calculator className="size-4" />
          Simulador
        </Button>

        <div className="ml-auto">
          <ActualizarListaButton
            disabled={refreshState.isRefreshActionDisabled}
            isRefreshing={isManualRefreshPending}
            onRefresh={() => void handleRefresh()}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-border bg-surface shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {refreshState.isInitialLoading ? (
          <SolicitudesContentLoader />
        ) : rows.length === 0 ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="inline-flex size-12 items-center justify-center rounded-full bg-verde/10 text-verde">
              <ClipboardList className="size-6" />
            </span>
            {error ? (
              <>
                <p className="font-semibold text-foreground">
                  No se pudieron cargar las solicitudes
                </p>
                <Button
                  className="rounded-full"
                  onClick={() => void handleRefresh()}
                  type="button"
                  variant="outline"
                >
                  Reintentar
                </Button>
              </>
            ) : (
              <>
                <p className="font-semibold text-foreground">
                  No tenés solicitudes en precarga
                </p>
                <p className="max-w-sm text-sm text-foreground-secondary">
                  Las solicitudes que empezás a cargar y todavía no enviaste
                  aparecen acá.
                </p>
                {canCreateNewSolicitud ? (
                  <Button
                    className="mt-1 rounded-full bg-verde px-5 font-semibold text-white hover:bg-verde/90"
                    onClick={() => navigate("/solicitudes/core/precarga/nueva")}
                    type="button"
                  >
                    <Plus className="size-4" />
                    Nueva solicitud
                  </Button>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <table className="w-full min-w-[56rem] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className={HEADER_CELL}>Fecha</th>
                <th className={HEADER_CELL}>Socio</th>
                <th className={HEADER_CELL}>Línea</th>
                <th className={HEADER_CELL}>Monto</th>
                <th className={HEADER_CELL}>Cuotas</th>
                <th className={`${HEADER_CELL} text-center`}>Para enviar</th>
                {showVendedor ? (
                  <th className={HEADER_CELL}>Vendedor</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  className="group cursor-pointer transition-colors hover:bg-verde/5 focus-visible:bg-verde/5 focus-visible:outline-none [&>td]:border-t [&>td]:border-border-soft [&:last-child>td]:border-b"
                  key={row.id}
                  onClick={() => abrirDetalle(row.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") abrirDetalle(row.id);
                  }}
                  style={row.rowStyle}
                  tabIndex={0}
                >
                  <td className="px-3 py-3 whitespace-nowrap text-foreground-secondary tabular-nums">
                    {row.fecha}
                  </td>
                  <td className="px-3 py-3">
                    <p className="font-semibold text-foreground">
                      {row.socio || "Sin nombre"}
                    </p>
                    {row.dni ? (
                      <p className="text-xs text-foreground-secondary tabular-nums">
                        DNI {row.dni}
                      </p>
                    ) : null}
                  </td>
                  <td className="max-w-56 truncate px-3 py-3" title={row.linea}>
                    {row.linea}
                  </td>
                  <td className="px-3 py-3 font-semibold whitespace-nowrap tabular-nums">
                    {row.monto}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                    {row.cuotas ? (
                      <>
                        {row.cuotas}
                        {row.cuotaResultante ? (
                          <span className="text-foreground-secondary">
                            {" "}× {row.cuotaResultante}
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </td>
                  <td
                    className="px-3 py-3 text-center whitespace-nowrap"
                    // Los botones de esta celda no abren el detalle.
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <ParaEnviarCell
                      estado={estadoParaEnviar.get(row.id) ?? "revisando"}
                      onCargarRecibo={() => setReciboPara(row)}
                      onEnviar={() => abrirEnvio(row)}
                    />
                  </td>
                  {showVendedor ? (
                    <td className="px-3 py-3 whitespace-nowrap text-foreground-secondary">
                      {row.vendedor}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ListaPaginacion
        onPageChange={setPage}
        page={page}
        pageSize={PAGE_SIZE}
        rowsCount={rows.length}
      />

      <AdjuntosLoteModal
        isSaving={isUploadingRecibo}
        onOpenChange={(open) => {
          if (!open) setReciboPara(null);
        }}
        onSave={handleCargarRecibo}
        open={reciboPara !== null}
        saveLabel="Cargar recibo"
        solicitudId={reciboPara?.id}
        tipoAdjuntoInicial={TIPO_RECIBO_SUELDO}
        title={
          reciboPara?.socio
            ? `Recibo de sueldo de ${reciboPara.socio}`
            : "Recibo de sueldo"
        }
      />

      <ConfirmDialog
        confirmLabel="Enviar a Riesgo"
        description={
          envioPara
            ? `La solicitud de ${envioPara.socio || "el socio"}${envioPara.monto ? ` por ${envioPara.monto}` : ""} pasa a Riesgo y sale de Precarga.`
            : ""
        }
        isConfirmDisabled={
          transicionesQuery.isPending ||
          !transicionEnviar ||
          transicionEnviar.blockedReason !== null ||
          faltaComentarioEnvio
        }
        isConfirming={isEnviando}
        onConfirm={() => void handleEnviar()}
        onOpenChange={(open) => {
          if (!open) setEnvioPara(null);
        }}
        open={envioPara !== null}
        title="¿Enviar a Riesgo?"
      >
        {transicionesQuery.isPending ? (
          <p className="text-sm text-foreground-muted">Verificando…</p>
        ) : transicionesQuery.isError || !transicionEnviar ? (
          <p className="text-sm text-destructive">
            Esta solicitud no se puede enviar desde acá. Abrila para ver su
            estado.
          </p>
        ) : transicionEnviar.blockedReason ? (
          <p className="text-sm text-destructive">
            {transicionEnviar.blockedReason}
          </p>
        ) : transicionEnviar.requiresComment ? (
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-foreground">Comentario</span>
            <textarea
              className="min-h-20 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-input-focus"
              disabled={isEnviando}
              onChange={(event) => setComentarioEnvio(event.target.value)}
              value={comentarioEnvioValue}
            />
          </label>
        ) : null}
      </ConfirmDialog>

      {isSimuladorOpen ? (
        <Suspense fallback={null}>
          <SimuladorPrestamoModal
            isLoadingLineas={lineasQuery.isLoading}
            lineas={lineasQuery.data ?? []}
            onOpenChange={setIsSimuladorOpen}
            open={isSimuladorOpen}
          />
        </Suspense>
      ) : null}
    </article>
  );
}

function ParaEnviarCell({
  estado,
  onCargarRecibo,
  onEnviar,
}: {
  estado: EstadoParaEnviar;
  onCargarRecibo: () => void;
  onEnviar: () => void;
}) {
  if (estado === "revisando") {
    return <span className="text-xs text-foreground-muted">Revisando…</span>;
  }

  if (estado === "desconocido") {
    return <span className="text-foreground-muted">—</span>;
  }

  if (estado === "falta-recibo") {
    return (
      <button
        className="inline-flex w-36 items-center justify-center gap-1.5 rounded-full border border-[#f3dfb8] bg-[#fdf1dc] px-3 py-1 text-xs font-semibold text-[#8a5a12] transition hover:bg-[#f9e4bd] focus-visible:ring-2 focus-visible:ring-[#8a5a12]/40 focus-visible:outline-none"
        onClick={onCargarRecibo}
        title="Cargar el recibo de sueldo"
        type="button"
      >
        <Paperclip className="size-3.5" />
        Falta recibo
      </button>
    );
  }

  return (
    <button
      className="inline-flex w-36 items-center justify-center gap-1.5 rounded-full border border-verde px-3 py-1 text-xs font-semibold text-verde transition hover:bg-verde hover:text-white focus-visible:ring-2 focus-visible:ring-verde/40 focus-visible:outline-none"
      onClick={onEnviar}
      title="Tiene recibo de sueldo: lista para enviar"
      type="button"
    >
      <Send className="size-3.5" />
      Enviar a Riesgo
    </button>
  );
}
