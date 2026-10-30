import { useMemo, useRef, useState } from "react";
import { History, Search } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useAuthSessionQuery } from "@/modules/auth/hooks/use-auth-session";
import { isVendedor } from "@/modules/auth/utils/auth-user";
import { ListaPaginacion } from "@/modules/solicitudes-core/components/lista-solicitudes-controles";
import { useSolicitudesCoreHistoricasQuery } from "@/modules/solicitudes-core/hooks/use-solicitudes-core-historicas-query";
import {
  resolveListRefreshState,
  runListManualRefresh,
} from "@/modules/solicitudes-core/utils/list-refresh-state";
import {
  LISTA_HEADER_CELL,
  buildSocioLista,
  formatFechaLista,
  formatMontoLista,
  hayTextoSeleccionado,
} from "@/modules/solicitudes-core/utils/lista-solicitudes-formato";
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
import { nombreEstado } from "@/modules/solicitudes-shared/utils/nombre-estado";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils/cn";

const PAGE_SIZE = 30;

// Misma presentacion que Recientes, sin la columna Firma (ya no se manda) ni
// el color de fila por estado: el estado ya se lee en su pildora.
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

// La novedad suele ser el comentario por defecto de la transicion: si repite
// el estado no aporta (igual que en Recientes).
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

export function SolicitudesCoreHistoricasPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const session = useAuthSessionQuery();
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [isManualRefreshPending, setIsManualRefreshPending] = useState(false);
  const [columnFilters, setColumnFilters] = useState<SolicitudesTableFilters>(
    () => {
      // Desde el tablero se llega con ?estado=... ya filtrado.
      const estadoFromUrl = searchParams.get("estado");
      return estadoFromUrl ? { estado: [estadoFromUrl] } : {};
    },
  );
  const isRefreshPendingRef = useRef(false);
  const { data, error, isFetching, isLoading, refetch } =
    useSolicitudesCoreHistoricasQuery({
      search: searchTerm,
      page,
      pageSize: PAGE_SIZE,
    });
  // El ejecutivo es interno: el vendedor no lo ve, igual que en el detalle.
  const mostrarEjecutivo = !isVendedor(session.data);

  const tableRows = useMemo<SolicitudesTableRow[]>(
    () =>
      (data ?? []).map((item) => ({
        asignadoA: resolveAssignmentLabel(item),
        cuotaResultante: formatMontoLista(item.cuotaResultante),
        cuotas: item.cuotas !== null ? String(item.cuotas) : "",
        estado: nombreEstado(item.estadoActual.code, item.estadoActual.name),
        estadoCode: item.estadoActual.code ?? "",
        fecha: formatFechaLista(item.createdAt),
        id: item.id,
        lineaPrestamo: item.lineaPrestamoDescripcion ?? "",
        montoFinal: formatMontoLista(item.montoAFinanciar),
        nombreCompleto: buildSocioLista(
          item.titular.apellidoDenominacion,
          item.titular.nombre,
        ),
        nroDocumento: item.titular.nroDocumento ?? "",
        nroSolicitud: item.nroSolicitud ?? "",
        ultimaNovedad: item.ultimaNovedad?.trim() ?? "",
        vendedorSolicitud: item.vendedorSolicitud ?? "",
      })),
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
  // Vendedor solo aporta si en la pagina hay mas de uno.
  const showVendedor =
    new Set(tableRows.map((row) => row.vendedorSolicitud)).size > 1;
  const hasActiveFilters = Object.keys(columnFilters).length > 0;
  const columnas = mostrarEjecutivo ? 8 : 7;

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
    navigate(`/solicitudes/core/detalle/${id}?origen=historicas`);
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

  function headerCell(label: string, columnKey?: keyof SolicitudesTableRow) {
    const column = columnKey ? FILTRO_COLUMNS[columnKey] : undefined;

    return (
      <th
        className={cn(LISTA_HEADER_CELL, "px-2.5", column && "relative pr-9")}
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
              <History className="size-6" />
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
              <p className="font-semibold text-foreground">
                {searchTerm.trim()
                  ? "No hay solicitudes que coincidan con la búsqueda"
                  : "No hay solicitudes históricas"}
              </p>
            )}
          </div>
        ) : (
          <table className="w-full min-w-[48rem] border-separate border-spacing-0 text-sm">
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
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-10 text-center text-foreground-secondary"
                    colSpan={columnas}
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
    </article>
  );
}
