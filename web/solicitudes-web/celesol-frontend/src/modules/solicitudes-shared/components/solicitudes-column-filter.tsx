import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Filter, Search } from "lucide-react";

import type {
  SolicitudesTableColumn,
  SolicitudesTableRow,
} from "@/modules/solicitudes-shared/components/solicitudes-table";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/utils/cn";

type DateFilterOption = {
  children: DateFilterOption[];
  label: string;
  token: string;
};

type DateFilterTreeNode = {
  children: DateFilterOption[];
  label: string;
  token: string;
};

type SolicitudesColumnFilterProps = {
  column: SolicitudesTableColumn;
  filterOptions: string[];
  selectedValues?: string[];
  onApply?: (
    columnKey: keyof SolicitudesTableRow,
    selectedValues?: string[],
  ) => void;
};

function formatFilterOptionLabel(value: string) {
  return value.trim() === "" ? "(Blanks)" : value;
}

function parseDateFilterValue(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);

  if (!match) {
    return null;
  }

  const [, day, month, year] = match;

  return {
    day,
    month,
    year,
  };
}

function buildDateFilterTree(values: string[]) {
  const blankValues = values.filter((value) => value.trim() === "");
  const yearsMap = new Map<string, DateFilterTreeNode>();

  values.forEach((value) => {
    const parsedValue = parseDateFilterValue(value);

    if (!parsedValue) {
      return;
    }

    const yearToken = `year:${parsedValue.year}`;
    const monthToken = `month:${parsedValue.year}-${parsedValue.month}`;
    const monthLabel = new Intl.DateTimeFormat("es-AR", {
      month: "long",
      timeZone: "UTC",
    }).format(
      new Date(`${parsedValue.year}-${parsedValue.month}-01T00:00:00Z`),
    );

    const yearNode = yearsMap.get(parsedValue.year) ?? {
      children: [],
      label: parsedValue.year,
      token: yearToken,
    };

    let monthNode = yearNode.children.find(
      (option) => option.token === monthToken,
    );

    if (!monthNode) {
      monthNode = {
        children: [],
        label: monthLabel,
        token: monthToken,
      };
      yearNode.children.push(monthNode);
    }

    const dayToken = `date:${value}`;

    if (!monthNode.children.some((option) => option.token === dayToken)) {
      monthNode.children = [
        ...monthNode.children,
        {
          children: [],
          label: value,
          token: dayToken,
        },
      ];
    }

    yearsMap.set(parsedValue.year, yearNode);
  });

  const years = Array.from(yearsMap.values())
    .map((yearNode) => ({
      ...yearNode,
      children: yearNode.children
        .sort((left, right) =>
          left.token.localeCompare(right.token, "es", { numeric: true }),
        )
        .map((monthNode) => ({
          ...monthNode,
          children: (monthNode.children ?? []).sort((left, right) =>
            left.label.localeCompare(right.label, "es", { numeric: true }),
          ),
        })),
    }))
    .sort((left, right) =>
      right.label.localeCompare(left.label, "es", { numeric: true }),
    );

  return {
    blankOption:
      blankValues.length > 0
        ? {
            label: "(Blanks)",
            token: "blank",
          }
        : null,
    years,
  };
}

function getAllDateFilterTokens(
  dateFilterTree: ReturnType<typeof buildDateFilterTree> | null,
) {
  if (!dateFilterTree) {
    return [];
  }

  return [
    ...(dateFilterTree.blankOption ? [dateFilterTree.blankOption.token] : []),
    ...dateFilterTree.years.map((yearNode) => yearNode.token),
    ...dateFilterTree.years.flatMap((yearNode) =>
      yearNode.children.flatMap((monthNode) => [
        monthNode.token,
        ...(monthNode.children ?? []).map((child) => child.token),
      ]),
    ),
  ];
}

export function SolicitudesColumnFilter({
  column,
  filterOptions,
  selectedValues,
  onApply,
}: SolicitudesColumnFilterProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [draftSelectedValues, setDraftSelectedValues] = useState<string[]>([]);
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    ready: boolean;
    top: number;
  } | null>(null);
  const [expandedDateYears, setExpandedDateYears] = useState<string[]>([]);
  const [expandedDateMonths, setExpandedDateMonths] = useState<string[]>([]);
  const isDateColumn = column.key === "fecha";
  const portalTarget =
    typeof document !== "undefined"
      ? (document.getElementById("app-content-overlays") ?? document.body)
      : null;

  const dateFilterTree = useMemo(
    () => (isDateColumn ? buildDateFilterTree(filterOptions) : null),
    [filterOptions, isDateColumn],
  );
  const allDateFilterTokens = useMemo(
    () => getAllDateFilterTokens(dateFilterTree),
    [dateFilterTree],
  );

  const displayedOptions = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    if (!normalizedSearch) {
      return filterOptions;
    }

    return filterOptions.filter((option) =>
      formatFilterOptionLabel(option).toLowerCase().includes(normalizedSearch),
    );
  }, [filterOptions, searchTerm]);

  const displayedDateFilterOptions = useMemo(() => {
    if (!dateFilterTree) {
      return null;
    }

    const normalizedSearch = searchTerm.trim().toLowerCase();

    if (!normalizedSearch) {
      return dateFilterTree;
    }

    return {
      blankOption: dateFilterTree.blankOption?.label
        .toLowerCase()
        .includes(normalizedSearch)
        ? dateFilterTree.blankOption
        : null,
      years: dateFilterTree.years
        .map((yearNode) => {
          const yearMatches = yearNode.label
            .toLowerCase()
            .includes(normalizedSearch);
          const matchingChildren = yearNode.children
            .map((monthNode) => {
              const monthMatches = monthNode.label
                .toLowerCase()
                .includes(normalizedSearch);
              const matchingDates = monthNode.children.filter((child) =>
                child.label.toLowerCase().includes(normalizedSearch),
              );

              if (!monthMatches && matchingDates.length === 0) {
                return null;
              }

              return {
                ...monthNode,
                children: monthMatches ? monthNode.children : matchingDates,
              };
            })
            .filter((monthNode) => monthNode !== null);

          if (!yearMatches && matchingChildren.length === 0) {
            return null;
          }

          return {
            ...yearNode,
            children: yearMatches ? yearNode.children : matchingChildren,
          };
        })
        .filter(
          (yearNode): yearNode is DateFilterTreeNode => yearNode !== null,
        ),
    };
  }, [dateFilterTree, searchTerm]);

  const hasActiveFilter = selectedValues !== undefined;
  const areAllOptionsSelected =
    filterOptions.length > 0 &&
    draftSelectedValues.length === filterOptions.length;
  const isAllDateOptionsSelected = isDateColumn
    ? allDateFilterTokens.length > 0 &&
      draftSelectedValues.length === allDateFilterTokens.length
    : areAllOptionsSelected;

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    function updateMenuPosition() {
      const buttonElement = buttonRef.current;
      const menuElement = menuRef.current;

      if (!buttonElement || !menuElement) {
        return;
      }

      const buttonRect = buttonElement.getBoundingClientRect();
      const menuWidth = menuElement.offsetWidth;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let left = buttonRect.left;
      let top = buttonRect.bottom + 8;

      if (left + menuWidth > viewportWidth - 16) {
        left = Math.max(16, viewportWidth - menuWidth - 16);
      }

      const menuHeight = menuElement.offsetHeight;

      if (top + menuHeight > viewportHeight - 16) {
        top = Math.max(16, buttonRect.top - menuHeight - 8);
      }

      setMenuPosition({ left, ready: true, top });
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [displayedOptions.length, filterOptions, isOpen, searchTerm]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const targetNode = event.target as Node;
      const clickedTrigger = containerRef.current?.contains(targetNode);
      const clickedMenu = menuRef.current?.contains(targetNode);

      if (!clickedTrigger && !clickedMenu) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="absolute top-2 right-2 z-20" ref={containerRef}>
      <button
        aria-label={`Filtrar ${column.label}`}
        className={cn(
          "inline-flex size-5 items-center justify-center rounded-sm text-foreground-secondary transition hover:bg-muted hover:text-foreground",
          hasActiveFilter && "bg-primary-soft text-primary",
        )}
        ref={buttonRef}
        onClick={() => {
          setSearchTerm("");
          setMenuPosition(null);
          setIsOpen((currentValue) => {
            const nextIsOpen = !currentValue;

            if (nextIsOpen) {
              setDraftSelectedValues(selectedValues ?? []);
              setExpandedDateYears([]);
              setExpandedDateMonths([]);
            }

            return nextIsOpen;
          });
        }}
        type="button"
      >
        <Filter className="size-3.5" />
      </button>

      {isOpen && portalTarget
        ? createPortal(
            <div
              className="pointer-events-auto fixed z-[200] w-80 rounded-md border border-border bg-surface p-3 text-left shadow-lg"
              ref={menuRef}
              style={{
                left: `${menuPosition?.left ?? 0}px`,
                top: `${menuPosition?.top ?? 0}px`,
                visibility: menuPosition?.ready ? "visible" : "hidden",
              }}
            >
              <div className="mb-3">
                <p className="text-[22px] leading-none font-semibold text-foreground">
                  Valores
                </p>
              </div>

              <div className="relative mb-3">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
                <Input
                  className="pl-9"
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Introduzca el texto a buscar..."
                  value={searchTerm}
                />
              </div>

              <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  checked={
                    isDateColumn
                      ? isAllDateOptionsSelected
                      : areAllOptionsSelected
                  }
                  className="size-4 rounded-sm border border-input-border accent-primary"
                  onChange={() => {
                    if (isDateColumn) {
                      setDraftSelectedValues(
                        isAllDateOptionsSelected ? [] : allDateFilterTokens,
                      );
                      return;
                    }

                    setDraftSelectedValues(
                      areAllOptionsSelected ? [] : filterOptions,
                    );
                  }}
                  type="checkbox"
                />
                <span>Seleccionar todo</span>
              </label>

              <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-background px-2 py-2">
                {isDateColumn ? (
                  !displayedDateFilterOptions ||
                  (displayedDateFilterOptions.years.length === 0 &&
                    !displayedDateFilterOptions.blankOption) ? (
                    <p className="px-1 py-3 text-sm text-foreground-muted">
                      No hay valores para mostrar.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {displayedDateFilterOptions.blankOption ? (
                        <label className="flex cursor-pointer items-center gap-2 px-1 py-1.5 text-sm text-foreground">
                          <span className="inline-flex w-4" />
                          <input
                            checked={draftSelectedValues.includes("blank")}
                            className="size-4 rounded-sm border border-input-border accent-primary"
                            onChange={() => {
                              const isChecked =
                                draftSelectedValues.includes("blank");

                              setDraftSelectedValues((currentValues) =>
                                isChecked
                                  ? currentValues.filter(
                                      (value) => value !== "blank",
                                    )
                                  : [...currentValues, "blank"],
                              );
                            }}
                            type="checkbox"
                          />
                          <span>
                            {displayedDateFilterOptions.blankOption.label}
                          </span>
                        </label>
                      ) : null}

                      {displayedDateFilterOptions.years.map((yearNode) => {
                        const isExpanded = expandedDateYears.includes(
                          yearNode.token,
                        );
                        const monthTokens = yearNode.children.map(
                          (child) => child.token,
                        );
                        const isYearChecked = draftSelectedValues.includes(
                          yearNode.token,
                        );

                        return (
                          <div key={yearNode.token}>
                            <div className="flex items-center gap-2 px-1 py-1.5 text-sm text-foreground">
                              <button
                                className="inline-flex size-4 items-center justify-center text-foreground-muted"
                                onClick={() => {
                                  setExpandedDateYears((currentYears) =>
                                    currentYears.includes(yearNode.token)
                                      ? currentYears.filter(
                                          (token) => token !== yearNode.token,
                                        )
                                      : [...currentYears, yearNode.token],
                                  );
                                }}
                                type="button"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="size-4" />
                                ) : (
                                  <ChevronRight className="size-4" />
                                )}
                              </button>
                              <input
                                checked={isYearChecked}
                                className="size-4 rounded-sm border border-input-border accent-primary"
                                onChange={() => {
                                  setDraftSelectedValues((currentValues) => {
                                    if (isYearChecked) {
                                      return currentValues.filter(
                                        (value) =>
                                          value !== yearNode.token &&
                                          !monthTokens.includes(value),
                                      );
                                    }

                                    return [
                                      ...currentValues.filter(
                                        (value) => !monthTokens.includes(value),
                                      ),
                                      yearNode.token,
                                    ];
                                  });
                                }}
                                type="checkbox"
                              />
                              <span>{yearNode.label}</span>
                            </div>

                            {isExpanded ? (
                              <div className="space-y-1 pl-7">
                                {yearNode.children.map((monthNode) => {
                                  const isMonthExpanded =
                                    expandedDateMonths.includes(
                                      monthNode.token,
                                    );
                                  const dayTokens = monthNode.children.map(
                                    (child) => child.token,
                                  );
                                  const isMonthChecked =
                                    isYearChecked ||
                                    draftSelectedValues.includes(
                                      monthNode.token,
                                    );

                                  return (
                                    <div key={monthNode.token}>
                                      <div className="flex items-center gap-2 px-1 py-1.5 text-sm text-foreground">
                                        <button
                                          className="inline-flex size-4 items-center justify-center text-foreground-muted"
                                          onClick={() => {
                                            setExpandedDateMonths(
                                              (currentMonths) =>
                                                currentMonths.includes(
                                                  monthNode.token,
                                                )
                                                  ? currentMonths.filter(
                                                      (token) =>
                                                        token !==
                                                        monthNode.token,
                                                    )
                                                  : [
                                                      ...currentMonths,
                                                      monthNode.token,
                                                    ],
                                            );
                                          }}
                                          type="button"
                                        >
                                          {isMonthExpanded ? (
                                            <ChevronDown className="size-4" />
                                          ) : (
                                            <ChevronRight className="size-4" />
                                          )}
                                        </button>
                                        <input
                                          checked={isMonthChecked}
                                          className="size-4 rounded-sm border border-input-border accent-primary"
                                          onChange={() => {
                                            setDraftSelectedValues(
                                              (currentValues) => {
                                                const withoutYearToken =
                                                  currentValues.filter(
                                                    (value) =>
                                                      value !== yearNode.token,
                                                  );

                                                if (isMonthChecked) {
                                                  return withoutYearToken.filter(
                                                    (value) =>
                                                      value !==
                                                        monthNode.token &&
                                                      !dayTokens.includes(
                                                        value,
                                                      ),
                                                  );
                                                }

                                                return [
                                                  ...withoutYearToken.filter(
                                                    (value) =>
                                                      !dayTokens.includes(
                                                        value,
                                                      ),
                                                  ),
                                                  monthNode.token,
                                                ];
                                              },
                                            );
                                          }}
                                          type="checkbox"
                                        />
                                        <span className="capitalize">
                                          {monthNode.label}
                                        </span>
                                      </div>

                                      {isMonthExpanded ? (
                                        <div className="space-y-1 pl-7">
                                          {monthNode.children.map((dayNode) => {
                                            const isDayChecked =
                                              isYearChecked ||
                                              isMonthChecked ||
                                              draftSelectedValues.includes(
                                                dayNode.token,
                                              );

                                            return (
                                              <label
                                                className="flex cursor-pointer items-center gap-2 px-1 py-1.5 text-sm text-foreground"
                                                key={dayNode.token}
                                              >
                                                <span className="inline-flex w-4" />
                                                <input
                                                  checked={isDayChecked}
                                                  className="size-4 rounded-sm border border-input-border accent-primary"
                                                  onChange={() => {
                                                    setDraftSelectedValues(
                                                      (currentValues) => {
                                                        const withoutParents =
                                                          currentValues.filter(
                                                            (value) =>
                                                              value !==
                                                                yearNode.token &&
                                                              value !==
                                                                monthNode.token,
                                                          );

                                                        return isDayChecked
                                                          ? withoutParents.filter(
                                                              (value) =>
                                                                value !==
                                                                dayNode.token,
                                                            )
                                                          : [
                                                              ...withoutParents,
                                                              dayNode.token,
                                                            ];
                                                      },
                                                    );
                                                  }}
                                                  type="checkbox"
                                                />
                                                <span>{dayNode.label}</span>
                                              </label>
                                            );
                                          })}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : displayedOptions.length === 0 ? (
                  <p className="px-1 py-3 text-sm text-foreground-muted">
                    No hay valores para mostrar.
                  </p>
                ) : (
                  displayedOptions.map((option) => {
                    const isChecked = draftSelectedValues.includes(option);

                    return (
                      <label
                        className="flex cursor-pointer items-center gap-2 px-1 py-1.5 text-sm text-foreground"
                        key={`${column.key}-${option || "__blank__"}`}
                      >
                        <input
                          checked={isChecked}
                          className="size-4 rounded-sm border border-input-border accent-primary"
                          onChange={() => {
                            setDraftSelectedValues((currentValues) =>
                              isChecked
                                ? currentValues.filter(
                                    (value) => value !== option,
                                  )
                                : [...currentValues, option],
                            );
                          }}
                          type="checkbox"
                        />
                        <span>{formatFilterOptionLabel(option)}</span>
                      </label>
                    );
                  })
                )}
              </div>

              <div className="mt-3 flex items-center justify-end gap-2">
                <Button
                  onClick={() => {
                    setDraftSelectedValues(selectedValues ?? []);
                    setSearchTerm("");
                    setIsOpen(false);
                  }}
                  type="button"
                  variant="outline"
                >
                  Cancelar
                </Button>
                <Button
                  className="min-w-28"
                  onClick={() => {
                    const nextValues =
                      !isDateColumn &&
                      draftSelectedValues.length === filterOptions.length
                        ? undefined
                        : isDateColumn &&
                            draftSelectedValues.length ===
                              allDateFilterTokens.length
                          ? undefined
                          : draftSelectedValues.length === 0
                            ? undefined
                            : draftSelectedValues;

                    onApply?.(column.key, nextValues);
                    setSearchTerm("");
                    setIsOpen(false);
                  }}
                  type="button"
                >
                  Aplicar
                </Button>
              </div>
            </div>,
            portalTarget,
          )
        : null}
    </div>
  );
}
