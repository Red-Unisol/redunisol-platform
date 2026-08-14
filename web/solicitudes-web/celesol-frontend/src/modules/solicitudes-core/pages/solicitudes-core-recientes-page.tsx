import { useMemo, useRef, useState } from "react";
import {
  ArchiveRestore,
  ArchiveX,
  CloudDownload,
  Ellipsis,
  FileCode,
  RefreshCw,
  Save,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { SolicitudesCoreListFooter } from "@/modules/solicitudes-core/components/solicitudes-core-list-footer";
import { useSolicitudesCoreRecientesQuery } from "@/modules/solicitudes-core/hooks/use-solicitudes-core-recientes-query";
import {
  resolveListRefreshState,
  runListManualRefresh,
} from "@/modules/solicitudes-core/utils/list-refresh-state";
import {
  buildSolicitudesTableFilterOptions,
  filterSolicitudesTableRows,
} from "@/modules/solicitudes/utils/solicitudes-table-filters";
import { SolicitudesContentLoader } from "@/modules/solicitudes-shared/components/solicitudes-content-loader";
import {
  SolicitudesTable,
  type SolicitudesTableColumn,
  type SolicitudesTableFilters,
  type SolicitudesTableRow,
} from "@/modules/solicitudes-shared/components/solicitudes-table";
import {
  SolicitudesToolbar,
  type SolicitudesToolbarAction,
} from "@/modules/solicitudes/components/solicitudes-toolbar";

const CORE_RECIENTES_COLUMNS: SolicitudesTableColumn[] = [
  {
    key: "vendedorSolicitud",
    label: "Vendedor Solicitud",
    minWidth: "min-w-32",
    filterable: true,
  },
  { key: "fecha", label: "Fecha", minWidth: "min-w-28", filterable: true },
  {
    key: "nombreCompleto",
    label: "Nombre Completo",
    minWidth: "min-w-48",
    filterable: true,
  },
  {
    key: "lineaPrestamo",
    label: "Línea Préstamo",
    minWidth: "min-w-44",
    filterable: true,
  },
  {
    key: "asignadoA",
    label: "Ejecutivo Solicitud",
    minWidth: "min-w-36",
    filterable: true,
  },
  {
    key: "linkFirmaDigital",
    label: "Link firma digital",
    minWidth: "min-w-44",
  },
  {
    key: "montoFinal",
    label: "Monto a Financiar",
    minWidth: "min-w-24",
    align: "right",
  },
  {
    key: "cuotas",
    label: "Cuotas",
    minWidth: "min-w-20",
    align: "right",
    filterable: true,
  },
  {
    key: "cuotaResultante",
    label: "Cuota Resultante",
    minWidth: "min-w-28",
    align: "right",
  },
  { key: "estado", label: "Estado", minWidth: "min-w-36", filterable: true },
  {
    key: "ultimaNovedad",
    label: "Última Novedad",
    minWidth: "min-w-36",
    filterable: true,
  },
];

const CORE_RECIENTES_LEFT_ACTIONS: SolicitudesToolbarAction[] = [];

const CORE_RECIENTES_RIGHT_ACTIONS: SolicitudesToolbarAction[] = [
  { disabled: true, id: "borrar-mover", label: "Borrar/Mover" },
  { disabled: true, icon: Save, id: "guardar" },
  { disabled: true, icon: FileCode, id: "exportar-xml" },
  { disabled: true, icon: CloudDownload, id: "vimarx" },
  {
    disabled: true,
    icon: ArchiveX,
    id: "archivar-solicitud",
    label: "Archivar Solicitud",
  },
  {
    disabled: true,
    icon: ArchiveRestore,
    id: "desarchivar-solicitud",
    label: "Desarchivar Solicitud",
  },
  { icon: RefreshCw, id: "refresh" },
  { disabled: true, icon: Ellipsis, id: "more-actions" },
];

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatAmount(value: number | string | null) {
  if (value === null || value === "") {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    useGrouping: false,
  }).format(value);
}

function buildNombreCompleto(apellido: string | null, nombre: string | null) {
  return [apellido?.trim(), nombre?.trim()].filter(Boolean).join(" ");
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

function getRowAppearanceStyle(row: SolicitudesTableRow, isSelected: boolean) {
  if (isSelected || !row.rowBackgroundColor) {
    return undefined;
  }

  return {
    backgroundColor: row.rowBackgroundColor,
  };
}

export function SolicitudesCoreRecientesPage() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [isManualRefreshPending, setIsManualRefreshPending] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [columnFilters, setColumnFilters] = useState<SolicitudesTableFilters>(
    {},
  );
  const isRefreshPendingRef = useRef(false);
  const { data, error, isFetching, isLoading, refetch } =
    useSolicitudesCoreRecientesQuery({
      nroDocumento: searchTerm,
      page,
      pageSize,
    });

  const tableRows = useMemo<SolicitudesTableRow[]>(() => {
    if (!data) {
      return [];
    }

    return data.map((item) => ({
      cuotaResultante: formatAmount(item.cuotaResultante),
      cuotas: item.cuotas !== null ? String(item.cuotas) : "",
      estado: item.estadoActual.name ?? "",
      fecha: formatDate(item.createdAt),
      id: item.id,
      linkFirmaDigital: item.linkFirmaDigital ?? "",
      asignadoA: resolveAssignmentLabel(item),
      lineaPrestamo: item.lineaPrestamoDescripcion ?? "",
      montoFinal: formatAmount(item.montoAFinanciar),
      nombreCompleto: buildNombreCompleto(
        item.titular.apellidoDenominacion,
        item.titular.nombre,
      ),
      nroDocumento: item.titular.nroDocumento ?? "",
      nroSolicitud: item.nroSolicitud ?? "",
      rowBackgroundColor: item.appearance?.backgroundColor ?? null,
      rowTextColor: item.appearance?.textColor ?? null,
      ultimaNovedad: item.ultimaNovedad?.trim() || "-",
      vendedorSolicitud: item.vendedorSolicitud ?? "",
    }));
  }, [data]);

  const filterOptions = useMemo(
    () => buildSolicitudesTableFilterOptions(tableRows, CORE_RECIENTES_COLUMNS),
    [tableRows],
  );
  const filteredRows = useMemo(
    () => filterSolicitudesTableRows(tableRows, "", columnFilters),
    [columnFilters, tableRows],
  );

  const hasNextPage = tableRows.length === pageSize;
  const pageCount = hasNextPage ? page + 1 : page;
  const totalItems =
    (page - 1) * pageSize + tableRows.length + (hasNextPage ? 1 : 0);
  const refreshState = resolveListRefreshState({
    hasData: data !== undefined,
    isFetching,
    isLoading,
    isManualRefreshPending,
  });
  const rightActions = useMemo(
    () =>
      CORE_RECIENTES_RIGHT_ACTIONS.map((action) =>
        action.id === "refresh"
          ? { ...action, disabled: refreshState.isRefreshActionDisabled }
          : action,
      ),
    [refreshState.isRefreshActionDisabled],
  );

  async function handleRefresh() {
    await runListManualRefresh({
      isRefreshActionDisabled: refreshState.isRefreshActionDisabled,
      isRefreshPendingRef,
      refetch,
      setIsManualRefreshPending,
    });
  }

  return (
    <article
      aria-busy={refreshState.isBackgroundRefreshing}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-sm"
    >
      <SolicitudesToolbar
        leftActions={CORE_RECIENTES_LEFT_ACTIONS}
        onAction={(actionId) => {
          if (actionId === "refresh") {
            void handleRefresh();
          }
        }}
        onSearchChange={(value) => {
          setSearchTerm(value);
          setPage(1);
        }}
        rightActions={rightActions}
        searchTerm={searchTerm}
      />

      <div className="min-h-0 flex-1">
        {refreshState.isInitialLoading ? (
          <SolicitudesContentLoader />
        ) : (
          <SolicitudesTable
            columnFilters={columnFilters}
            columns={CORE_RECIENTES_COLUMNS}
            emptyMessage={
              error ? "No se pudieron cargar las solicitudes." : undefined
            }
            filterOptions={filterOptions}
            onApplyColumnFilter={(columnKey, selectedValues) => {
              setColumnFilters((current) => {
                const next = { ...current };
                if (selectedValues === undefined) {
                  delete next[columnKey];
                } else {
                  next[columnKey] = selectedValues;
                }
                return next;
              });
              setPage(1);
            }}
            onRowClick={(row) => {
              const searchParams = new URLSearchParams({
                origen: "recientes",
              });

              navigate(
                `/solicitudes/core/detalle/${row.id}?${searchParams.toString()}`,
              );
            }}
            onToggleAllRows={() => {
              const areAllRowsSelected =
                filteredRows.length > 0 &&
                filteredRows.every((row) => selectedIds.includes(row.id));

              if (areAllRowsSelected) {
                setSelectedIds([]);
                return;
              }

              setSelectedIds(filteredRows.map((row) => row.id));
            }}
            onToggleRow={(rowId) => {
              setSelectedIds((currentIds) =>
                currentIds.includes(rowId)
                  ? currentIds.filter((id) => id !== rowId)
                  : [...currentIds, rowId],
              );
            }}
            rowStyle={getRowAppearanceStyle}
            rows={filteredRows}
            selectedIds={selectedIds}
          />
        )}
      </div>

      <SolicitudesCoreListFooter
        currentPage={page}
        isRefreshing={refreshState.isBackgroundRefreshing}
        itemLabel="solicitudes"
        onPageChange={(nextPage) => {
          setPage(nextPage);
          setSelectedIds([]);
        }}
        onPageSizeChange={(value) => {
          setPageSize(value);
          setPage(1);
          setSelectedIds([]);
        }}
        pageCount={Math.max(1, pageCount)}
        pageSize={pageSize}
        pageSizeOptions={[10, 20, 30, 50, 100]}
        selectedCount={selectedIds.length}
        totalItems={Math.max(tableRows.length, totalItems)}
      />
    </article>
  );
}
