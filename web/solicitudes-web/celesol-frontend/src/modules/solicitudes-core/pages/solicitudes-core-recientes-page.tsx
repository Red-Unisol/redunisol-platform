import {
  type CSSProperties,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Calculator, ClipboardList, Copy, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { useAuthSessionQuery } from "@/modules/auth/hooks/use-auth-session";
import type { AuthUser } from "@/modules/auth/services/auth-api";
import { isVendedor } from "@/modules/auth/utils/auth-user";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils/cn";

import { ListaPaginacion } from "@/modules/solicitudes-core/components/lista-solicitudes-controles";
import { useLineasDelAgenteQuery } from "@/modules/solicitudes-core/hooks/use-lineas-del-agente-query";
import { useSolicitudesCoreRecientesQuery } from "@/modules/solicitudes-core/hooks/use-solicitudes-core-recientes-query";
import {
  LISTA_HEADER_CELL,
  buildRowStyleLista,
  buildSocioLista,
  formatFechaLista,
  formatMontoLista,
  hayTextoSeleccionado,
} from "@/modules/solicitudes-core/utils/lista-solicitudes-formato";
import {
  resolveListRefreshState,
  runListManualRefresh,
} from "@/modules/solicitudes-core/utils/list-refresh-state";
import {
  buildSolicitudesTableFilterOptions,
  filterSolicitudesTableRows,
} from "@/modules/solicitudes/utils/solicitudes-table-filters";
import { SolicitudesColumnFilter } from "@/modules/solicitudes-shared/components/solicitudes-column-filter";
import { SolicitudesContentLoader } from "@/modules/solicitudes-shared/components/solicitudes-content-loader";
import type {
  SolicitudesTableColumn,
  SolicitudesTableFilters,
  SolicitudesTableRow,
} from "@/modules/solicitudes-shared/components/solicitudes-table";
import { getEstadoBadgeVariant } from "@/modules/solicitudes-shared/utils/estado-badge-variant";
import { loadSimuladorPrestamoModal } from "@/modules/solicitudes-shared/utils/load-simulador-prestamo-modal";
import { prefetchWhenIdle } from "@/modules/solicitudes-shared/utils/prefetch-when-idle";
import { nombreEstado } from "@/modules/solicitudes-shared/utils/nombre-estado";

const SimuladorPrestamoModal = lazy(() =>
  loadSimuladorPrestamoModal().then((module) => ({
    default: module.SimuladorPrestamoModal,
  })),
);

const PAGE_SIZE = 30;

// Columnas con filtro (filtran la página cargada, como antes).
const FILTRO_COLUMNS: Partial<
  Record<keyof SolicitudesTableRow, SolicitudesTableColumn>
> = {
  asignadoA: {
    filterable: true,
    key: "asignadoA",
    label: "Ejecutivo",
    minWidth: "",
  },
  estado: { filterable: true, key: "estado", label: "Estado", minWidth: "" },
  fecha: { filterable: true, key: "fecha", label: "Fecha", minWidth: "" },
  lineaPrestamo: {
    filterable: true,
    key: "lineaPrestamo",
    label: "Línea",
    minWidth: "",
  },
};
const FILTRO_COLUMNS_LIST = Object.values(FILTRO_COLUMNS).filter(
  (column): column is SolicitudesTableColumn => column !== undefined,
);

// La novedad suele ser el comentario por defecto de la transición ("Preaprobada"
// para "Pre Aprobada"): si repite el estado no aporta.
function normalizarTextoEstado(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word && word !== "de" && word !== "y")
    .join("");
}

function novedadAporta(novedad: string, estado: string) {
  return (
    novedad.length > 0 &&
    normalizarTextoEstado(novedad) !== normalizarTextoEstado(estado)
  );
}

function resolveAssignmentLabel(item: {
  assignedToUser: {
    email: string | null;
    fullName: string | null;
    id: string;
  } | null;
  assignedToUserId: string | null;
}) {
  const fullName = item.assignedToUser?.fullName?.trim();

  if (fullName) {
    return fullName;
  }

  const email = item.assignedToUser?.email?.trim();

  if (email) {
    return email;
  }

  if (item.assignedToUserId) {
    return "Asignado";
  }

  return "Sin asignar";
}

export function SolicitudesCoreRecientesPage() {
  const session = useAuthSessionQuery();
  if (!session.data) return <SolicitudesContentLoader />;
  return (
    <RecientesList
      key={`${session.data.id}:${session.data.workflowOwnerId}:${session.data.isSystemAdmin}`}
      user={session.data}
    />
  );
}

function RecientesList({ user }: { user: AuthUser }) {
  // El vendedor arranca viendo todas las suyas, en cualquier area: si
  // arrancara en "Mi area", la solicitud se le iria al enviarla a Riesgo.
  // "Ver todas" nunca le muestra las de otros (lo limita el backend).
  const esVendedor = user.workflowOwner?.code === "VENDEDORES";
  const areaLabel =
    user.workflowOwner?.code === "RIESGO"
      ? "Riesgo"
      : esVendedor
        ? "Pendientes de mi lado"
        : (user.workflowOwner?.name ?? "Sin área asignada");
  const todasLabel = esVendedor ? "Todas mis solicitudes" : "Ver todas";
  const [vista, setVista] = useState<"mi-area" | "todas">(() =>
    !user.isSystemAdmin &&
    user.workflowOwnerId &&
    user.workflowOwner?.code === "RIESGO"
      ? "mi-area"
      : "todas",
  );
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [isManualRefreshPending, setIsManualRefreshPending] = useState(false);
  const [columnFilters, setColumnFilters] = useState<SolicitudesTableFilters>(
    {},
  );
  const isRefreshPendingRef = useRef(false);
  const [isSimuladorOpen, setIsSimuladorOpen] = useState(false);
  const lineasQuery = useLineasDelAgenteQuery(isSimuladorOpen);
  useEffect(() => prefetchWhenIdle(loadSimuladorPrestamoModal), []);
  const { data, error, isFetching, isLoading, refetch } =
    useSolicitudesCoreRecientesQuery({
      vista,
      userId: user.id,
      workflowOwnerId: user.workflowOwnerId,
      search: searchTerm,
      page,
      pageSize: PAGE_SIZE,
    });

  const tableRows = useMemo<SolicitudesTableRow[]>(
    () =>
      (data ?? []).map((item) => ({
        asignadoA: resolveAssignmentLabel(item),
        cuotaResultante: formatMontoLista(item.cuotaResultante),
        cuotas: item.cuotas !== null ? String(item.cuotas) : "",
        estado: nombreEstado(item.estadoActual.code, item.estadoActual.name),
        estadoCode: item.estadoActual.code ?? "",
        fecha: formatFechaLista(item.createdAt),
        nroSolicitud: item.nroSolicitud ?? "",
        id: item.id,
        lineaPrestamo: item.lineaPrestamoDescripcion ?? "",
        linkFirmaDigital: item.linkFirmaDigital ?? "",
        montoFinal: formatMontoLista(item.montoAFinanciar),
        nombreCompleto: buildSocioLista(
          item.titular.apellidoDenominacion,
          item.titular.nombre,
        ),
        nroDocumento: item.titular.nroDocumento ?? "",
        ultimaNovedad: item.ultimaNovedad?.trim() ?? "",
        vendedorSolicitud: item.vendedorSolicitud ?? "",
      })),
    [data],
  );
  const rowStyles = useMemo(
    () =>
      new Map<string, CSSProperties | undefined>(
        (data ?? []).map((item) => [
          item.id,
          buildRowStyleLista(item.appearance),
        ]),
      ),
    [data],
  );

  const filterOptions = useMemo(
    () => buildSolicitudesTableFilterOptions(tableRows, FILTRO_COLUMNS_LIST),
    [tableRows],
  );
  const filteredRows = useMemo(
    () => filterSolicitudesTableRows(tableRows, "", columnFilters),
    [columnFilters, tableRows],
  );
  // Vendedor solo aporta si en la página hay más de uno.
  const showVendedor =
    new Set(tableRows.map((row) => row.vendedorSolicitud)).size > 1;
  const hasActiveFilters = Object.keys(columnFilters).length > 0;
  // El ejecutivo es interno: el vendedor no lo ve, igual que en el detalle.
  const mostrarEjecutivo = !isVendedor(user);

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

  function abrirDetalle(id: string) {
    navigate(`/solicitudes/core/detalle/${id}?origen=recientes`);
  }

  function applyColumnFilter(
    columnKey: keyof SolicitudesTableRow,
    selectedValues?: string[],
  ) {
    setColumnFilters((current) => {
      const next = { ...current };
      if (selectedValues === undefined) {
        delete next[columnKey];
      } else {
        next[columnKey] = selectedValues;
      }
      return next;
    });
  }

  function headerCell(
    label: string,
    columnKey?: keyof SolicitudesTableRow,
    className = "px-2.5",
  ) {
    const column = columnKey ? FILTRO_COLUMNS[columnKey] : undefined;

    return (
      <th
        className={cn(LISTA_HEADER_CELL, className, column && "relative pr-9")}
      >
        {label}
        {column ? (
          <SolicitudesColumnFilter
            column={column}
            filterOptions={filterOptions[column.key] ?? []}
            onApply={applyColumnFilter}
            selectedValues={columnFilters[column.key]}
          />
        ) : null}
      </th>
    );
  }

  return (
    <article
      aria-busy={refreshState.isBackgroundRefreshing}
      className="flex h-full min-h-0 flex-col gap-3 p-2 md:p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
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

        {user.workflowOwner?.code !== "TESORERIA" ? (
          <div
            aria-label="Vista por área"
            className="order-last flex h-10 w-full items-center rounded-full border border-border bg-surface p-1 sm:order-none sm:inline-flex sm:w-auto"
            role="group"
          >
            {(["mi-area", "todas"] as const).map((value) => (
              <button
                aria-pressed={vista === value}
                className={cn(
                  "h-8 flex-1 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none sm:px-4 sm:text-sm",
                  vista === value
                    ? "bg-verde text-white"
                    : "text-foreground-secondary hover:text-foreground",
                )}
                disabled={value === "mi-area" && !user.workflowOwnerId}
                key={value}
                onClick={() => {
                  if (vista === value) return;
                  setVista(value);
                  setPage(1);
                }}
                type="button"
              >
                {value === "mi-area" ? areaLabel : todasLabel}
              </button>
            ))}
          </div>
        ) : null}

        <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
          <label className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
            <span className="sr-only">
              Buscar por solicitud, DNI, nombre o apellido
            </span>
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-foreground-muted" />
            <input
              className="h-10 w-full rounded-full border border-border bg-surface pr-4 pl-10 text-sm outline-none placeholder:text-foreground-muted focus:border-input-focus focus:ring-2 focus:ring-input-focus/20"
              onChange={(event) => {
                setSearchTerm(event.target.value);
                setPage(1);
              }}
              placeholder="Buscar por solicitud, DNI, nombre o apellido"
              type="search"
              value={searchTerm}
            />
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-border bg-surface shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {refreshState.isInitialLoading ? (
          <SolicitudesContentLoader />
        ) : tableRows.length === 0 ? (
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
                  {searchTerm.trim()
                    ? "No hay solicitudes que coincidan con la búsqueda"
                    : vista === "mi-area"
                      ? "No hay solicitudes pendientes de tu lado"
                      : "No hay solicitudes recientes"}
                </p>
                {vista === "mi-area" && !searchTerm.trim() ? (
                  <p className="max-w-sm text-sm text-foreground-secondary">
                    Cuando una solicitud quede en manos de tu área, aparece acá.
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <table className="w-full min-w-[52rem] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {headerCell("Fecha", "fecha")}
                {headerCell("Nº")}
                {headerCell("Socio")}
                {headerCell("Línea", "lineaPrestamo")}
                {headerCell("Monto")}
                {headerCell("Cuotas")}
                {mostrarEjecutivo ? headerCell("Ejecutivo", "asignadoA") : null}
                {headerCell("Estado", "estado")}
                {headerCell("Firma")}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-10 text-center text-foreground-secondary"
                    colSpan={mostrarEjecutivo ? 9 : 8}
                  >
                    Ninguna solicitud de esta página cumple los filtros.{" "}
                    <button
                      className="font-semibold text-verde underline-offset-2 hover:underline"
                      onClick={() => setColumnFilters({})}
                      type="button"
                    >
                      Quitar filtros
                    </button>
                  </td>
                </tr>
              ) : null}
              {filteredRows.map((row) => (
                <tr
                  className="group cursor-pointer transition-colors hover:bg-verde/5 focus-visible:bg-verde/5 focus-visible:outline-none [&>td]:border-t [&>td]:border-border-soft [&:last-child>td]:border-b"
                  key={row.id}
                  onClick={() => {
                    if (!hayTextoSeleccionado()) abrirDetalle(row.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") abrirDetalle(row.id);
                  }}
                  style={rowStyles.get(row.id)}
                  tabIndex={0}
                >
                  <td className="px-2.5 py-2.5 whitespace-nowrap text-foreground-secondary tabular-nums">
                    {row.fecha}
                  </td>
                  <td className="px-2.5 py-2.5 whitespace-nowrap text-foreground-secondary tabular-nums">
                    {row.nroSolicitud}
                  </td>
                  <td className="min-w-36 px-2.5 py-2.5">
                    <p className="font-semibold text-foreground">
                      {row.nombreCompleto || "Sin nombre"}
                    </p>
                    {row.nroDocumento ? (
                      <p className="text-xs text-foreground-secondary tabular-nums">
                        DNI {row.nroDocumento}
                      </p>
                    ) : null}
                  </td>
                  <td
                    className="max-w-28 truncate px-2.5 py-2.5"
                    title={row.lineaPrestamo}
                  >
                    {row.lineaPrestamo}
                  </td>
                  <td className="px-2.5 py-2.5 font-semibold whitespace-nowrap tabular-nums">
                    {row.montoFinal}
                  </td>
                  <td className="px-2.5 py-2.5 whitespace-nowrap tabular-nums">
                    {row.cuotas ? (
                      <>
                        {row.cuotas}
                        {row.cuotaResultante ? (
                          <p className="text-xs text-foreground-secondary">
                            × {row.cuotaResultante}
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </td>
                  {mostrarEjecutivo ? (
                    <td className="max-w-32 px-2.5 py-2.5">
                      <p
                        className={cn(
                          "truncate",
                          row.asignadoA === "Sin asignar"
                            ? "text-foreground-muted"
                            : "text-foreground",
                        )}
                        title={row.asignadoA}
                      >
                        {row.asignadoA}
                      </p>
                      {showVendedor && row.vendedorSolicitud ? (
                        <p
                          className="truncate text-xs text-foreground-secondary"
                          title={`Vendedor: ${row.vendedorSolicitud}`}
                        >
                          Vend.: {row.vendedorSolicitud}
                        </p>
                      ) : null}
                    </td>
                  ) : null}
                  <td className="px-2.5 py-2.5">
                    {row.estado ? (
                      <Badge
                        className="max-w-44"
                        dot
                        variant={getEstadoBadgeVariant(row.estadoCode ?? "")}
                      >
                        {row.estado}
                      </Badge>
                    ) : null}
                    {novedadAporta(row.ultimaNovedad, row.estado) ? (
                      <p
                        className="mt-1 max-w-44 truncate text-xs text-foreground-secondary"
                        title={row.ultimaNovedad}
                      >
                        {row.ultimaNovedad}
                      </p>
                    ) : null}
                  </td>
                  <td
                    className="px-2.5 py-2.5 whitespace-nowrap"
                    // Los botones de esta celda no abren el detalle.
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    {row.linkFirmaDigital ? (
                      <FirmaAcciones url={row.linkFirmaDigital} />
                    ) : (
                      <span className="text-foreground-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <ListaPaginacion
            onPageChange={setPage}
            page={page}
            pageSize={PAGE_SIZE}
            rowsCount={tableRows.length}
          />
        </div>
        {hasActiveFilters ? (
          <button
            className="text-sm font-semibold text-verde underline-offset-2 hover:underline"
            onClick={() => setColumnFilters({})}
            type="button"
          >
            Quitar filtros
          </button>
        ) : null}
      </div>

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

// El link de firma se manda al socio: se copia, sin mostrar la URL entera.
function FirmaAcciones({ url }: { url: string }) {
  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link de firma digital copiado");
    } catch {
      toast.error(
        "No se pudo copiar el link. Abrí la solicitud para copiarlo desde ahí.",
      );
    }
  }

  const botonClassName =
    "inline-flex size-7 items-center justify-center rounded-full border border-border bg-surface text-foreground-secondary transition hover:border-verde hover:text-verde focus-visible:ring-2 focus-visible:ring-verde/40 focus-visible:outline-none";

  return (
    <div className="flex items-center gap-1.5">
      <button
        aria-label="Copiar link de firma digital"
        className={botonClassName}
        onClick={() => void copiar()}
        title="Copiar link de firma"
        type="button"
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}
