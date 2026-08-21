import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
import { SolicitudesTablePagination } from "@/modules/solicitudes-shared/components/solicitudes-table-pagination";
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
import { useSolicitudesPrecargaQuery } from "@/modules/solicitudes/hooks/use-solicitudes-precarga-query";
import { normalizeSolicitudNumber } from "@/modules/solicitudes/utils/solicitud-detail-navigation";
import { loadSimuladorPrestamoModal } from "@/modules/solicitudes-shared/utils/load-simulador-prestamo-modal";
import { prefetchWhenIdle } from "@/modules/solicitudes-shared/utils/prefetch-when-idle";
import {
  buildSolicitudesTableFilterOptions,
  filterSolicitudesTableRows,
} from "@/modules/solicitudes/utils/solicitudes-table-filters";

const SimuladorPrestamoModal = lazy(() =>
  loadSimuladorPrestamoModal().then((module) => ({
    default: module.SimuladorPrestamoModal,
  })),
);

const PRECARGA_COLUMNS: SolicitudesTableColumn[] = [
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
    sortable: true,
  },
  {
    key: "lineaPrestamo",
    label: "Línea Préstamo",
    minWidth: "min-w-44",
    filterable: true,
  },
  {
    key: "montoFinal",
    label: "Monto a Financiar",
    minWidth: "min-w-24",
    align: "right",
    filterable: true,
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
    filterable: true,
  },
  { key: "estado", label: "Estado", minWidth: "min-w-36", filterable: true },
  {
    key: "ultimaNovedad",
    label: "Última Novedad",
    minWidth: "min-w-40",
    filterable: true,
  },
];

const PRECARGA_LEFT_ACTIONS: SolicitudesToolbarAction[] = [
  { icon: Plus, id: "nuevo", primary: true },
  { icon: Calculator, id: "simulador" },
];

const PRECARGA_RIGHT_ACTIONS: SolicitudesToolbarAction[] = [
  { id: "borrar-mover", label: "Borrar/Mover" },
  { icon: Save, id: "guardar" },
  { icon: FileCode, id: "exportar-xml" },
  { icon: CloudDownload, id: "vimarx" },
  {
    disabled: true,
    icon: ArchiveX,
    id: "archivar-solicitud",
    label: "Archivar Solicitud",
  },
  {
    icon: ArchiveRestore,
    id: "desarchivar-solicitud",
    label: "Desarchivar Solicitud",
  },
  { icon: RefreshCw, id: "refresh" },
  { icon: Ellipsis, id: "more-actions" },
];

export function SolicitudesPrecargaPage() {
  const navigate = useNavigate();
  const sessionQuery = useAuthSessionQuery();
  const canCreateNewSolicitud = canCreateSolicitud(sessionQuery.data);
  const [isSimuladorOpen, setIsSimuladorOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [columnFilters, setColumnFilters] = useState<SolicitudesTableFilters>(
    {},
  );
  const { data, error, isLoading } = useSolicitudesPrecargaQuery();
  const leftActions = useMemo(
    () =>
      PRECARGA_LEFT_ACTIONS.map((action) =>
        action.id === "nuevo"
          ? { ...action, disabled: !canCreateNewSolicitud }
          : action,
      ),
    [canCreateNewSolicitud],
  );

  useEffect(() => prefetchWhenIdle(loadSimuladorPrestamoModal), []);

  const tableRows = useMemo<SolicitudesTableRow[]>(() => {
    if (!data) {
      return [];
    }

    return data.map((item) => ({
      cuotas: item.cuotas !== null ? String(item.cuotas) : "",
      cuotaResultante:
        item.cuotaResultante !== null ? String(item.cuotaResultante) : "",
      estado: typeof item.estado === "string" ? item.estado : "",
      fecha: item.fecha ?? "",
      id: item.id,
      lineaPrestamo: item.lineaPrestamo ?? "",
      montoFinal:
        item.montoAFinanciar !== null
          ? new Intl.NumberFormat("es-AR", {
              maximumFractionDigits: 2,
              minimumFractionDigits: 2,
              useGrouping: false,
            }).format(item.montoAFinanciar)
          : "",
      nombreCompleto: item.nombreCompleto ?? "",
      nroSolicitud: item.nroSolicitud ?? "",
      oid: item.oid ?? "",
      ultimaNovedad:
        typeof item.ultimaNovedad === "string" ? item.ultimaNovedad : "",
      vendedorSolicitud: item.vendedorSolicitud ?? "",
    }));
  }, [data]);

  const filterOptions = useMemo(
    () => buildSolicitudesTableFilterOptions(tableRows, PRECARGA_COLUMNS),
    [tableRows],
  );
  const filteredRows = useMemo(
    () => filterSolicitudesTableRows(tableRows, searchTerm, columnFilters),
    [columnFilters, searchTerm, tableRows],
  );

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredRows.slice(startIndex, startIndex + pageSize);
  }, [currentPage, filteredRows, pageSize]);

  const isInitialLoading = isLoading && !data;

  return (
    <article className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-sm">
      <SolicitudesToolbar
        leftActions={leftActions}
        onAction={(actionId) => {
          if (actionId === "nuevo") {
            navigate("/solicitudes/nueva");
          }

          if (actionId === "simulador") {
            setIsSimuladorOpen(true);
          }
        }}
        onSimularIntent={loadSimuladorPrestamoModal}
        onSearchChange={(value) => {
          setSearchTerm(value);
          setPage(1);
        }}
        rightActions={PRECARGA_RIGHT_ACTIONS}
        searchTerm={searchTerm}
      />

      <div className="min-h-0 flex-1">
        {isInitialLoading ? (
          <SolicitudesContentLoader />
        ) : (
          <SolicitudesTable
            columnFilters={columnFilters}
            columns={PRECARGA_COLUMNS}
            emptyMessage={
              error ? "No se pudieron cargar las solicitudes." : undefined
            }
            filterOptions={filterOptions}
            onApplyColumnFilter={(columnKey, selectedValues) => {
              setColumnFilters((currentFilters) => {
                const nextFilters = { ...currentFilters };

                if (selectedValues === undefined) {
                  delete nextFilters[columnKey];
                } else {
                  nextFilters[columnKey] = selectedValues;
                }

                return nextFilters;
              });
              setPage(1);
            }}
            onToggleAllRows={() => {
              const areAllPageRowsSelected =
                pageRows.length > 0 &&
                pageRows.every((row) => selectedIds.includes(row.id));

              if (areAllPageRowsSelected) {
                setSelectedIds((currentIds) =>
                  currentIds.filter(
                    (id) => !pageRows.some((row) => row.id === id),
                  ),
                );
                return;
              }

              setSelectedIds((currentIds) => {
                const nextIds = new Set(currentIds);

                pageRows.forEach((row) => {
                  nextIds.add(row.id);
                });

                return Array.from(nextIds);
              });
            }}
            onToggleRow={(rowId) => {
              setSelectedIds((currentIds) =>
                currentIds.includes(rowId)
                  ? currentIds.filter((id) => id !== rowId)
                  : [...currentIds, rowId],
              );
            }}
            onRowClick={(row) => {
              const oid = row.oid?.trim();
              if (!oid) {
                return;
              }

              const searchParams = new URLSearchParams({
                oid,
                origen: "precarga",
              });
              const nroSolicitud = normalizeSolicitudNumber(row.nroSolicitud);

              if (nroSolicitud) {
                searchParams.set("nroSolicitud", nroSolicitud);
              }

              navigate(`/solicitudes/detalle?${searchParams.toString()}`);
            }}
            rows={pageRows}
            selectedIds={selectedIds}
          />
        )}
      </div>

      <SolicitudesTablePagination
        currentPage={currentPage}
        itemLabel="solicitudes"
        onPageChange={setPage}
        onPageSizeChange={(value) => {
          setPageSize(value);
          setPage(1);
        }}
        pageCount={pageCount}
        pageSize={pageSize}
        pageSizeOptions={[10, 20, 30, 50, 100]}
        selectedCount={selectedIds.length}
        totalItems={filteredRows.length}
      />
      {isSimuladorOpen ? (
        <Suspense fallback={null}>
          <SimuladorPrestamoModal
            onOpenChange={setIsSimuladorOpen}
            open={isSimuladorOpen}
          />
        </Suspense>
      ) : null}
    </article>
  );
}
