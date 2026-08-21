import type {
  SolicitudesTableColumn,
  SolicitudesTableFilters,
  SolicitudesTableRow,
} from "@/modules/solicitudes-shared/components/solicitudes-table";

export type SolicitudesTableFilterOptions = Partial<
  Record<keyof SolicitudesTableRow, string[]>
>;

function parseDateValue(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);

  if (!match) {
    return null;
  }

  const [, , month, year] = match;

  return { month, year };
}

function matchesDateFilter(value: string, selectedValues: string[]) {
  if (selectedValues.length === 0) {
    return true;
  }

  if (value.trim() === "") {
    return selectedValues.includes("blank");
  }

  const parsedDate = parseDateValue(value);

  if (!parsedDate) {
    return selectedValues.includes(value);
  }

  return (
    selectedValues.includes(`year:${parsedDate.year}`) ||
    selectedValues.includes(`month:${parsedDate.year}-${parsedDate.month}`) ||
    selectedValues.includes(`date:${value}`)
  );
}

export function buildSolicitudesTableFilterOptions(
  rows: SolicitudesTableRow[],
  columns: SolicitudesTableColumn[],
): SolicitudesTableFilterOptions {
  return columns.reduce<SolicitudesTableFilterOptions>(
    (accumulator, column) => {
      if (!column.filterable) {
        return accumulator;
      }

      const uniqueValues = Array.from(
        new Set(rows.map((row) => row[column.key] ?? "")),
      ).sort((left, right) => {
        if (left === right) {
          return 0;
        }

        if (left === "") {
          return -1;
        }

        if (right === "") {
          return 1;
        }

        return left.localeCompare(right, "es", {
          numeric: true,
          sensitivity: "base",
        });
      });

      accumulator[column.key] = uniqueValues;
      return accumulator;
    },
    {},
  );
}

export function filterSolicitudesTableRows(
  rows: SolicitudesTableRow[],
  searchTerm: string,
  columnFilters: SolicitudesTableFilters,
) {
  const normalizedSearch = searchTerm.trim().toLowerCase();

  return rows.filter((row) => {
    const matchesColumnFilters = Object.entries(columnFilters).every(
      ([columnKey, selectedValues]) => {
        if (!selectedValues) {
          return true;
        }

        const rowValue = row[columnKey as keyof SolicitudesTableRow] ?? "";

        if (columnKey === "fecha") {
          return matchesDateFilter(rowValue, selectedValues);
        }

        return selectedValues.includes(rowValue);
      },
    );

    if (!matchesColumnFilters) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    return Object.values(row).some((value) => {
      if (typeof value !== "string") {
        return false;
      }

      return value.toLowerCase().includes(normalizedSearch);
    });
  });
}
