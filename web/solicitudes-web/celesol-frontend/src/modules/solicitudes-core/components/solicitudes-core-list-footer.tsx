import { SolicitudesTablePagination } from "@/modules/solicitudes-shared/components/solicitudes-table-pagination";

type SolicitudesCoreListFooterProps = {
  currentPage: number;
  isRefreshing: boolean;
  itemLabel: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageCount: number;
  pageSize: number;
  pageSizeOptions: number[];
  selectedCount?: number;
  totalItems: number;
};

export function SolicitudesCoreListFooter({
  currentPage,
  isRefreshing,
  itemLabel,
  onPageChange,
  onPageSizeChange,
  pageCount,
  pageSize,
  pageSizeOptions,
  selectedCount,
  totalItems,
}: SolicitudesCoreListFooterProps) {
  return (
    <div aria-busy={isRefreshing} className="shrink-0">
      <SolicitudesTablePagination
        currentPage={currentPage}
        itemLabel={itemLabel}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        pageCount={pageCount}
        pageSize={pageSize}
        pageSizeOptions={pageSizeOptions}
        selectedCount={selectedCount}
        totalItems={totalItems}
      />
      <div className="flex min-h-8 items-center border-t border-border bg-background/70 px-3 py-2 text-xs text-foreground-secondary">
        <span
          aria-hidden={!isRefreshing}
          aria-live="polite"
          className={isRefreshing ? "opacity-100" : "opacity-0"}
          role="status"
        >
          Actualizando solicitudes...
        </span>
      </div>
    </div>
  );
}
