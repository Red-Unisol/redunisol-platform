import { ArrowUpDown } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { SolicitudesColumnFilter } from "@/modules/solicitudes-shared/components/solicitudes-column-filter";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { TableEmptyState } from "@/shared/components/ui/table-empty-state";

export type SolicitudesTableRow = {
  acceso?: string;
  asignadoA?: string;
  areaActual?: string;
  cuotaResultante?: string;
  fecha: string;
  estado: string;
  estadoCode?: string;
  id: string;
  lineaPrestamo: string;
  linkFirmaDigital?: string;
  montoFinal: string;
  nombreCompleto: string;
  nroDocumento?: string;
  nroSolicitud?: string;
  oid?: string;
  ultimaNovedad: string;
  vendedorSolicitud: string;
  cuotas: string;
  rowBackgroundColor?: string | null;
  rowTextColor?: string | null;
};

export type SolicitudesTableColumn = {
  align?: "center" | "left" | "right";
  filterable?: boolean;
  key: keyof SolicitudesTableRow;
  label: string;
  minWidth: string;
  sortable?: boolean;
};

export type SolicitudesTableFilters = Partial<
  Record<keyof SolicitudesTableRow, string[]>
>;

type SolicitudesTableFilterOptions = Partial<
  Record<keyof SolicitudesTableRow, string[]>
>;

type SolicitudesTableProps = {
  columnFilters?: SolicitudesTableFilters;
  columns: SolicitudesTableColumn[];
  emptyMessage?: ReactNode;
  filterOptions?: SolicitudesTableFilterOptions;
  rowClassName?: (row: SolicitudesTableRow, isSelected: boolean) => string;
  rowStyle?: (
    row: SolicitudesTableRow,
    isSelected: boolean,
  ) => CSSProperties | undefined;
  rows: SolicitudesTableRow[];
  selectedIds: string[];
  onApplyColumnFilter?: (
    columnKey: keyof SolicitudesTableRow,
    selectedValues?: string[],
  ) => void;
  onToggleAllRows: () => void;
  onToggleRow: (rowId: string) => void;
  onRowClick?: (row: SolicitudesTableRow) => void;
};

function getColumnAlignment(align: SolicitudesTableColumn["align"]) {
  if (align === "right") {
    return "text-right";
  }

  if (align === "center") {
    return "text-center";
  }

  return "text-left";
}

export function SolicitudesTable({
  columnFilters = {},
  columns,
  emptyMessage = <TableEmptyState />,
  filterOptions = {},
  rowClassName,
  rowStyle,
  rows,
  selectedIds,
  onApplyColumnFilter,
  onRowClick,
  onToggleAllRows,
  onToggleRow,
}: SolicitudesTableProps) {
  const areAllRowsSelected =
    rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));

  return (
    <div className="h-full overflow-auto">
      <table
        className={`w-full min-w-[1320px] border-separate border-spacing-0 text-sm ${rows.length === 0 ? "h-full" : ""}`}
      >
        <thead className="bg-muted/60">
          <tr>
            <th className="sticky top-0 z-10 w-12 border-r border-b border-border bg-muted/90 px-3 py-3 text-center">
              <div className="flex items-center justify-center">
                <Checkbox
                  aria-label="Seleccionar todas las filas"
                  checked={areAllRowsSelected}
                  className="size-4 rounded-sm"
                  onCheckedChange={() => onToggleAllRows()}
                />
              </div>
            </th>

            {columns.map((column) => (
              <th
                className={`sticky top-0 z-10 relative border-r border-b border-border bg-muted/90 px-2 py-2 font-semibold text-foreground ${column.minWidth} ${getColumnAlignment(column.align)}`}
                key={column.key}
              >
                <div className="pr-10">
                  <span className="block max-w-44 whitespace-normal leading-tight">
                    {column.label}
                  </span>
                </div>
                {column.sortable ? (
                  <ArrowUpDown className="absolute top-2.5 right-6 size-3.5 text-foreground-secondary" />
                ) : null}
                {column.filterable ? (
                  <SolicitudesColumnFilter
                    column={column}
                    filterOptions={filterOptions[column.key] ?? []}
                    onApply={onApplyColumnFilter}
                    selectedValues={columnFilters[column.key]}
                  />
                ) : null}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className={rows.length === 0 ? "h-full" : undefined}>
          {rows.length === 0 ? (
            <tr className="h-full">
              <td
                className="h-full border-r border-b border-border px-3 py-0 align-middle text-center text-foreground-muted"
                colSpan={columns.length + 1}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const isSelected = selectedIds.includes(row.id);
              const defaultRowClassName = isSelected
                ? "bg-primary/5"
                : "bg-surface";
              const resolvedRowClassName =
                rowClassName?.(row, isSelected) ?? defaultRowClassName;
              const resolvedRowStyle = rowStyle?.(row, isSelected);
              const interactiveRowClassName = onRowClick
                ? `${resolvedRowClassName} cursor-pointer`
                : resolvedRowClassName;

              return (
                <tr
                  className={interactiveRowClassName}
                  key={row.id}
                  onClick={() => onRowClick?.(row)}
                  style={resolvedRowStyle}
                >
                  <td
                    className="border-r border-b border-border px-3 py-2 text-center"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="flex items-center justify-center">
                      <Checkbox
                        aria-label={`Seleccionar fila ${row.id}`}
                        checked={isSelected}
                        className="size-4 rounded-sm"
                        onCheckedChange={() => onToggleRow(row.id)}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </div>
                  </td>

                  {columns.map((column) => (
                    <td
                      className={`border-r border-b border-border px-2 py-2 align-top ${getColumnAlignment(column.align)}`}
                      key={column.key}
                      style={
                        row.rowTextColor
                          ? {
                              color: row.rowTextColor,
                            }
                          : undefined
                      }
                    >
                      <div className="max-w-full whitespace-normal break-words leading-snug">
                        {row[column.key] || (
                          <span className="text-foreground-muted">&nbsp;</span>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
