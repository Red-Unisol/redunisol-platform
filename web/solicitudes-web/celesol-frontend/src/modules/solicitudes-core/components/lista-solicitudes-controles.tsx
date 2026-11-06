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

// total: si la lista lo conoce, define si hay otra página y se muestra en el resumen.
// nombres: para listas que no son de solicitudes (p. ej. socios).
export function ListaPaginacion({
  page,
  pageSize,
  rowsCount,
  onPageChange,
  total,
  nombres = { singular: "solicitud", plural: "solicitudes" },
}: {
  page: number;
  pageSize: number;
  rowsCount: number;
  onPageChange: (page: number) => void;
  total?: number;
  nombres?: { singular: string; plural: string };
}) {
  const firstItem = (page - 1) * pageSize + 1;
  const hasNextPage =
    total === undefined
      ? rowsCount === pageSize
      : firstItem + rowsCount - 1 < total;

  if (rowsCount === 0 && page === 1) {
    return null;
  }

  // Con una sola página alcanza con el total; con varias, el rango ("1–2" se leía "1 de 2").
  const resumen =
    rowsCount === 0
      ? "Sin resultados en esta página"
      : page === 1 && !hasNextPage
        ? `${rowsCount} ${rowsCount === 1 ? nombres.singular : nombres.plural}`
        : `${nombres.plural.charAt(0).toUpperCase()}${nombres.plural.slice(1)} ${firstItem} a ${firstItem + rowsCount - 1}${
            total === undefined ? "" : ` de ${total.toLocaleString("es-AR")}`
          }`;

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
