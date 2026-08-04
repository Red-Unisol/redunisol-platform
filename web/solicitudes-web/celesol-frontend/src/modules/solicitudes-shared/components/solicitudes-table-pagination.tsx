import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { StyledSelect } from "@/shared/components/ui/styled-select";

type SolicitudesTablePaginationProps = {
  currentPage: number;
  itemLabel: string;
  pageCount: number;
  pageSize: number;
  pageSizeOptions: number[];
  selectedCount?: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

function getVisiblePages(currentPage: number, pageCount: number) {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, 4, 5];
  }

  if (currentPage >= pageCount - 2) {
    return [
      pageCount - 4,
      pageCount - 3,
      pageCount - 2,
      pageCount - 1,
      pageCount,
    ];
  }

  return [
    currentPage - 2,
    currentPage - 1,
    currentPage,
    currentPage + 1,
    currentPage + 2,
  ];
}

export function SolicitudesTablePagination({
  currentPage,
  itemLabel,
  pageCount,
  pageSize,
  pageSizeOptions,
  selectedCount = 0,
  totalItems,
  onPageChange,
  onPageSizeChange,
}: SolicitudesTablePaginationProps) {
  const pageNumbers = getVisiblePages(currentPage, pageCount);

  return (
    <div className="flex flex-col gap-3 border-t border-border bg-background/70 px-3 py-2 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-1">
        <Button
          disabled={currentPage === 1}
          onClick={() => onPageChange(1)}
          size="icon-xs"
          variant="outline"
        >
          <ChevronsLeft className="size-3.5" />
        </Button>
        <Button
          disabled={currentPage === 1}
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          size="icon-xs"
          variant="outline"
        >
          <ChevronLeft className="size-3.5" />
        </Button>

        {pageNumbers.map((pageNumber) => (
          <Button
            className={currentPage === pageNumber ? "shadow-none" : ""}
            key={pageNumber}
            onClick={() => onPageChange(pageNumber)}
            size="icon-xs"
            variant={currentPage === pageNumber ? "default" : "outline"}
          >
            {pageNumber}
          </Button>
        ))}

        <Button
          disabled={currentPage === pageCount}
          onClick={() => onPageChange(Math.min(pageCount, currentPage + 1))}
          size="icon-xs"
          variant="outline"
        >
          <ChevronRight className="size-3.5" />
        </Button>
        <Button
          disabled={currentPage === pageCount}
          onClick={() => onPageChange(pageCount)}
          size="icon-xs"
          variant="outline"
        >
          <ChevronsRight className="size-3.5" />
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm text-foreground-secondary md:justify-end">
        <span>
          {totalItems} {itemLabel}
          {selectedCount > 0 ? ` - ${selectedCount} seleccionadas` : ""}
        </span>

        <div className="flex items-center gap-2">
          <span>Tamaño de página:</span>
          <StyledSelect
            ariaLabel="Tamaño de página"
            className="w-20"
            onChange={(value) => onPageSizeChange(Number(value))}
            options={pageSizeOptions.map((option) => ({
              label: String(option),
              value: String(option),
            }))}
            value={String(pageSize)}
          />
        </div>
      </div>
    </div>
  );
}
