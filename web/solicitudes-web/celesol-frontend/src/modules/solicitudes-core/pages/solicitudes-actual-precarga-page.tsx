import { useMemo, useRef, useState } from "react";
import {
  ArchiveRestore,
  ArchiveX,
  Calculator,
  CloudDownload,
  Ellipsis,
  FileCode,
  Plus,
  RefreshCw,
  Save,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useAuthSessionQuery } from "@/modules/auth/hooks/use-auth-session";
import { canCreateSolicitud } from "@/modules/auth/utils/auth-user";
import { SolicitudesCoreListFooter } from "@/modules/solicitudes-core/components/solicitudes-core-list-footer";
import {
  resolveListRefreshState,
  runListManualRefresh,
} from "@/modules/solicitudes-core/utils/list-refresh-state";
import { SolicitudesContentLoader } from "@/modules/solicitudes-shared/components/solicitudes-content-loader";
import {
  SolicitudesTable,
  type SolicitudesTableColumn,
  type SolicitudesTableRow,
} from "@/modules/solicitudes-shared/components/solicitudes-table";
import {
  SolicitudesToolbar,
  type SolicitudesToolbarAction,
} from "@/modules/solicitudes/components/solicitudes-toolbar";
import { useSolicitudesCorePrecargaQuery } from "@/modules/solicitudes-core/hooks/use-solicitudes-core-precarga-query";

const CORE_PRECARGA_COLUMNS: SolicitudesTableColumn[] = [
  {
    key: "vendedorSolicitud",
    label: "Vendedor Solicitud",
    minWidth: "min-w-32",
  },
  { key: "fecha", label: "Fecha", minWidth: "min-w-28" },
  {
    key: "nombreCompleto",
    label: "Nombre Completo",
    minWidth: "min-w-48",
  },
  {
    key: "lineaPrestamo",
    label: "Línea Préstamo",
    minWidth: "min-w-44",
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
  },
  {
    key: "cuotaResultante",
    label: "Cuota Resultante",
    minWidth: "min-w-28",
    align: "right",
  },
  { key: "estado", label: "Estado", minWidth: "min-w-36" },
  {
    key: "ultimaNovedad",
    label: "Última Novedad",
    minWidth: "min-w-36",
  },
];

const CORE_PRECARGA_LEFT_ACTIONS: SolicitudesToolbarAction[] = [
  { icon: Plus, id: "nuevo", primary: true },
  { disabled: true, icon: Calculator, id: "simulador" },
];

const CORE_PRECARGA_RIGHT_ACTIONS: SolicitudesToolbarAction[] = [
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

function getRowAppearanceStyle(row: SolicitudesTableRow, isSelected: boolean) {
  if (isSelected || !row.rowBackgroundColor) {
    return undefined;
  }

  return {
    backgroundColor: row.rowBackgroundColor,
  };
}

export function SolicitudesActualPrecargaPage() {
  const navigate = useNavigate();
  const sessionQuery = useAuthSessionQuery();
  const canCreateNewSolicitud = canCreateSolicitud(sessionQuery.data);
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [isManualRefreshPending, setIsManualRefreshPending] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const isRefreshPendingRef = useRef(false);
  const { data, error, isFetching, isLoading, refetch } =
    useSolicitudesCorePrecargaQuery({
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
      CORE_PRECARGA_RIGHT_ACTIONS.map((action) =>
        action.id === "refresh"
          ? { ...action, disabled: refreshState.isRefreshActionDisabled }
          : action,
      ),
    [refreshState.isRefreshActionDisabled],
  );
  const leftActions = useMemo(
    () =>
      canCreateNewSolicitud
        ? CORE_PRECARGA_LEFT_ACTIONS
        : CORE_PRECARGA_LEFT_ACTIONS.filter((action) => action.id !== "nuevo"),
    [canCreateNewSolicitud],
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
        leftActions={leftActions}
        onAction={(actionId) => {
          if (actionId === "nuevo") {
            navigate("/solicitudes/core/precarga/nueva");
          }

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
            columns={CORE_PRECARGA_COLUMNS}
            emptyMessage={
              error ? "No se pudieron cargar las solicitudes." : undefined
            }
            onRowClick={(row) => {
              const searchParams = new URLSearchParams({
                origen: "precarga",
              });

              navigate(
                `/solicitudes/core/detalle/${row.id}?${searchParams.toString()}`,
              );
            }}
            onToggleAllRows={() => {
              const areAllRowsSelected =
                tableRows.length > 0 &&
                tableRows.every((row) => selectedIds.includes(row.id));

              if (areAllRowsSelected) {
                setSelectedIds([]);
                return;
              }

              setSelectedIds(tableRows.map((row) => row.id));
            }}
            onToggleRow={(rowId) => {
              setSelectedIds((currentIds) =>
                currentIds.includes(rowId)
                  ? currentIds.filter((id) => id !== rowId)
                  : [...currentIds, rowId],
              );
            }}
            rowStyle={getRowAppearanceStyle}
            rows={tableRows}
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
