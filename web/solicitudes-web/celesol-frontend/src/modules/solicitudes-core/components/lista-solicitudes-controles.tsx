import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";

import { Button } from "@/shared/components/ui/button";

// Controles comunes de las listas de solicitudes (Precarga, Recientes).

// isRefreshing: solo cuando lo pidió la persona; las actualizaciones automáticas no giran la rueda.
export function ActualizarListaButton({
  disabled,
  isRefreshing,
  onRefresh,
}: {
  disabled: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-live="polite"
        className="hidden text-xs text-foreground-muted sm:inline"
        role="status"
      >
        {isRefreshing ? "Actualizando…" : ""}
      </span>
      <Button
        aria-label="Actualizar lista"
        className="size-10 rounded-full bg-surface text-foreground-secondary"
        disabled={disabled}
        onClick={onRefresh}
        size="icon"
        title="Actualizar lista"
        type="button"
        variant="outline"
      >
        <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
}

export function ListaPaginacion({
  page,
  pageSize,
  rowsCount,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  rowsCount: number;
  onPageChange: (page: number) => void;
}) {
  const hasNextPage = rowsCount === pageSize;
  const firstItem = (page - 1) * pageSize + 1;

  if (rowsCount === 0 && page === 1) {
    return null;
  }

  // Con una sola página alcanza con el total; con varias, el rango ("1–2" se leía "1 de 2").
  const resumen =
    rowsCount === 0
      ? "Sin resultados en esta página"
      : page === 1 && !hasNextPage
        ? `${rowsCount} ${rowsCount === 1 ? "solicitud" : "solicitudes"}`
        : `Solicitudes ${firstItem} a ${firstItem + rowsCount - 1}`;

  return (
    <div className="flex items-center justify-between gap-2 px-1 text-sm text-foreground-secondary">
      <span className="tabular-nums">{resumen}</span>
      {page > 1 || hasNextPage ? (
        <div className="flex items-center gap-1">
          <Button
            className="rounded-full"
            disabled={page === 1}
            onClick={() => onPageChange(page - 1)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <ChevronLeft className="size-4" />
            Anterior
          </Button>
          <span className="px-2 tabular-nums">Página {page}</span>
          <Button
            className="rounded-full"
            disabled={!hasNextPage}
            onClick={() => onPageChange(page + 1)}
            size="sm"
            type="button"
            variant="ghost"
          >
            Siguiente
            <ChevronRight className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
