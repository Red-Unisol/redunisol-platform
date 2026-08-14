import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import * as React from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  PopoverAnchor,
  PopoverContent,
  PopoverRoot,
} from "@/shared/components/ui/popover";
import { cn } from "@/shared/utils/cn";

type DateInputProps = Omit<
  React.ComponentProps<"input">,
  "onChange" | "type" | "value"
> & {
  locale?: string;
  onChange?: (value: string) => void;
  value?: string;
  yearRange?: { from: number; to: number };
};

function formatIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const parsed = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );

  if (formatIso(parsed) !== value) {
    return null;
  }

  return parsed;
}

function normalizeDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseLocalDate(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) {
    return null;
  }

  const parsed = new Date(
    Number(match[3]),
    Number(match[2]) - 1,
    Number(match[1]),
  );

  if (
    parsed.getFullYear() !== Number(match[3]) ||
    parsed.getMonth() !== Number(match[2]) - 1 ||
    parsed.getDate() !== Number(match[1])
  ) {
    return null;
  }

  return parsed;
}

function parseDateInput(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  return parseIso(normalized) ?? parseLocalDate(normalized);
}

function withinBounds(date: Date, min?: Date | null, max?: Date | null) {
  const time = normalizeDate(date).getTime();

  if (min && time < normalizeDate(min).getTime()) {
    return false;
  }

  if (max && time > normalizeDate(max).getTime()) {
    return false;
  }

  return true;
}

function monthLabel(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: "long" }).format(date);
}

function yearLabel(date: Date) {
  return String(date.getFullYear());
}

function monthHasEnabledDay(month: Date, min?: Date | null, max?: Date | null) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();

  for (let day = 1; day <= lastDay; day += 1) {
    if (withinBounds(new Date(year, monthIndex, day), min, max)) {
      return true;
    }
  }

  return false;
}

function yearHasEnabledDay(year: number, min?: Date | null, max?: Date | null) {
  for (let month = 0; month < 12; month += 1) {
    if (monthHasEnabledDay(new Date(year, month, 1), min, max)) {
      return true;
    }
  }

  return false;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function DateInput({
  className,
  defaultValue,
  disabled,
  locale = "es-AR",
  max,
  min,
  onBlur,
  onChange,
  onKeyDown,
  value,
  yearRange,
  ...props
}: DateInputProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<"day" | "month" | "year">(
    "day",
  );
  const [hasInvalidValue, setHasInvalidValue] = React.useState(false);
  const [inputValue, setInputValue] = React.useState(
    typeof value === "string"
      ? value
      : typeof defaultValue === "string"
        ? defaultValue
        : "",
  );

  const today = React.useMemo(() => normalizeDate(new Date()), []);
  const initialDate = React.useMemo(
    () =>
      parseIso(
        typeof value === "string"
          ? value
          : typeof defaultValue === "string"
            ? defaultValue
            : "",
      ) ?? today,
    [defaultValue, today, value],
  );
  const [displayMonth, setDisplayMonth] = React.useState(() =>
    startOfMonth(initialDate),
  );

  React.useEffect(() => {
    if (typeof value === "string") {
      setInputValue(value);
      setHasInvalidValue(false);
      const parsed = parseIso(value);
      if (parsed) {
        setDisplayMonth(startOfMonth(parsed));
      }
    }
  }, [value]);

  const minDate = React.useMemo(
    () => (typeof min === "string" ? parseIso(min) : null),
    [min],
  );
  const maxDate = React.useMemo(
    () => (typeof max === "string" ? parseIso(max) : null),
    [max],
  );
  const selectedDate = React.useMemo(() => parseIso(inputValue), [inputValue]);
  const effectiveYearRange = React.useMemo(() => {
    const nowYear = new Date().getFullYear();
    const minYear = minDate?.getFullYear() ?? nowYear - 80;
    const maxYear = maxDate?.getFullYear() ?? nowYear + 20;
    const fallback = {
      from: Math.min(minYear, maxYear),
      to: Math.max(minYear, maxYear),
    };

    if (!yearRange) {
      return fallback;
    }

    return {
      from: Math.min(yearRange.from, yearRange.to),
      to: Math.max(yearRange.from, yearRange.to),
    };
  }, [maxDate, minDate, yearRange]);
  const [yearPageStart, setYearPageStart] = React.useState(() => {
    const displayYear = initialDate.getFullYear();
    const base = displayYear - ((displayYear - effectiveYearRange.from) % 12);

    return Math.max(
      effectiveYearRange.from,
      Math.min(base, effectiveYearRange.to - 11),
    );
  });

  const commitTextValue = React.useCallback(
    (text: string) => {
      const parsed = parseDateInput(text);

      if (!parsed) {
        if (!text.trim()) {
          setHasInvalidValue(false);
          onChange?.("");
          return;
        }

        setHasInvalidValue(true);
        return;
      }

      if (!withinBounds(parsed, minDate, maxDate)) {
        setHasInvalidValue(true);
        return;
      }

      const isoValue = formatIso(parsed);
      setInputValue(isoValue);
      setHasInvalidValue(false);
      onChange?.(isoValue);
      setDisplayMonth(startOfMonth(parsed));
    },
    [maxDate, minDate, onChange],
  );

  const monthText = React.useMemo(
    () => monthLabel(displayMonth, locale),
    [displayMonth, locale],
  );
  const yearText = React.useMemo(() => yearLabel(displayMonth), [displayMonth]);
  const monthOptions = React.useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => {
        const date = new Date(displayMonth.getFullYear(), index, 1);
        return {
          disabled: !monthHasEnabledDay(date, minDate, maxDate),
          label: new Intl.DateTimeFormat(locale, { month: "short" })
            .format(date)
            .replace(".", "")
            .slice(0, 3),
          monthIndex: index,
        };
      }),
    [displayMonth, locale, maxDate, minDate],
  );
  const yearOptions = React.useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => yearPageStart + index).filter(
        (year) =>
          year >= effectiveYearRange.from && year <= effectiveYearRange.to,
      ),
    [effectiveYearRange.from, effectiveYearRange.to, yearPageStart],
  );

  const navigatePrev = () => {
    if (viewMode === "day") {
      setDisplayMonth(
        (current) => new Date(current.getFullYear(), current.getMonth() - 1, 1),
      );
      return;
    }

    if (viewMode === "month") {
      setDisplayMonth(
        (current) => new Date(current.getFullYear() - 1, current.getMonth(), 1),
      );
      return;
    }

    setYearPageStart((current) =>
      Math.max(effectiveYearRange.from, current - 12),
    );
  };

  const navigateNext = () => {
    if (viewMode === "day") {
      setDisplayMonth(
        (current) => new Date(current.getFullYear(), current.getMonth() + 1, 1),
      );
      return;
    }

    if (viewMode === "month") {
      setDisplayMonth(
        (current) => new Date(current.getFullYear() + 1, current.getMonth(), 1),
      );
      return;
    }

    setYearPageStart((current) =>
      Math.min(effectiveYearRange.to - 11, current + 12),
    );
  };

  const goToMonthView = () => setViewMode("month");
  const goToYearView = () => setViewMode("year");

  React.useEffect(() => {
    if (open) {
      setViewMode("day");
      const anchor = selectedDate ?? today;
      setDisplayMonth(startOfMonth(anchor));
      const base =
        anchor.getFullYear() -
        ((anchor.getFullYear() - effectiveYearRange.from) % 12);
      setYearPageStart(
        Math.max(
          effectiveYearRange.from,
          Math.min(base, effectiveYearRange.to - 11),
        ),
      );
    }
  }, [
    effectiveYearRange.from,
    effectiveYearRange.to,
    open,
    selectedDate,
    today,
  ]);

  return (
    <PopoverRoot onOpenChange={setOpen} open={open}>
      <div className="group relative" ref={rootRef}>
        <PopoverAnchor asChild>
          <div className="w-full">
            <Input
              className={cn(
                "date-input pr-11 text-foreground aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
                hasInvalidValue
                  ? "border-danger focus-visible:border-danger focus-visible:ring-danger/20"
                  : "",
                className,
              )}
              disabled={disabled}
              onBlur={(event) => {
                commitTextValue(event.currentTarget.value);
                onBlur?.(event);
              }}
              onChange={(event) => {
                setInputValue(event.currentTarget.value);
                setHasInvalidValue(false);
              }}
              onClick={() => {
                if (!disabled) {
                  setOpen(true);
                }
              }}
              onFocus={() => {
                if (!disabled) {
                  setOpen(true);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitTextValue(
                    (event.currentTarget as HTMLInputElement).value,
                  );
                }

                if (event.key === "Escape") {
                  setOpen(false);
                }

                onKeyDown?.(event);
              }}
              placeholder="dd/mm/aaaa"
              type="text"
              value={inputValue}
              {...props}
            />
          </div>
        </PopoverAnchor>

        <button
          aria-label="Abrir calendario"
          className="absolute top-1/2 right-1 z-10 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-foreground-muted transition-colors hover:text-foreground focus-visible:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled}
          onClick={() => setOpen(true)}
          type="button"
        >
          <CalendarDays className="size-4" />
        </button>
      </div>

      <PopoverContent
        align="start"
        avoidCollisions
        className="date-picker-popover w-[22.75rem] max-w-[calc(100vw-1.5rem)] p-3"
        collisionPadding={10}
        onInteractOutside={(event) => {
          const target = event.target as Node | null;
          if (target && rootRef.current?.contains(target)) {
            event.preventDefault();
          }
        }}
        onOpenAutoFocus={(event) => event.preventDefault()}
        side="bottom"
        sticky="partial"
      >
        <div className="date-picker-header">
          <Button
            onClick={navigatePrev}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            {viewMode === "year" ? (
              <ChevronsLeft className="size-4" />
            ) : (
              <ChevronLeft className="size-4" />
            )}
          </Button>
          <div className="date-picker-header-center">
            <button
              className="date-picker-header-button"
              onClick={goToMonthView}
              type="button"
            >
              {monthText}
            </button>
            <button
              className="date-picker-header-button"
              onClick={goToYearView}
              type="button"
            >
              {yearText}
            </button>
          </div>
          <Button
            onClick={navigateNext}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            {viewMode === "year" ? (
              <ChevronsRight className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </Button>
        </div>

        <div className="date-picker-body">
          {viewMode === "day" ? (
            <div className="date-picker-panel">
              <DayPicker
                className="date-picker"
                classNames={{
                  caption: "date-picker-caption-hidden",
                  caption_label: "date-picker-caption-label-hidden",
                  day: "date-picker-day",
                  day_button: "date-picker-day-button",
                  disabled: "date-picker-disabled",
                  hidden: "date-picker-hidden",
                  month_caption: "date-picker-month-caption-hidden",
                  month_grid: "date-picker-month-grid",
                  outside: "date-picker-outside",
                  month: "date-picker-month",
                  months: "date-picker-months",
                  selected: "date-picker-selected",
                  today: "date-picker-today",
                  week: "date-picker-week",
                  weekday: "date-picker-weekday",
                  weekdays: "date-picker-weekdays",
                }}
                disabled={[
                  ...(minDate ? [{ before: minDate }] : []),
                  ...(maxDate ? [{ after: maxDate }] : []),
                ]}
                fixedWeeks
                hideNavigation
                mode="single"
                month={displayMonth}
                onMonthChange={(nextMonth) =>
                  setDisplayMonth(startOfMonth(nextMonth))
                }
                onSelect={(date) => {
                  if (!date) {
                    return;
                  }

                  const isoValue = formatIso(date);
                  setInputValue(isoValue);
                  setHasInvalidValue(false);
                  onChange?.(isoValue);
                  setOpen(false);
                }}
                selected={selectedDate ?? undefined}
                showOutsideDays
              />
            </div>
          ) : null}

          {viewMode === "month" ? (
            <div className="date-picker-grid date-picker-panel">
              {monthOptions.map((monthOption) => {
                const isSelected =
                  displayMonth.getMonth() === monthOption.monthIndex;

                return (
                  <button
                    className={cn(
                      "date-picker-grid-item",
                      isSelected ? "date-picker-grid-item-selected" : "",
                    )}
                    disabled={monthOption.disabled}
                    key={monthOption.monthIndex}
                    onClick={() => {
                      if (monthOption.disabled) {
                        return;
                      }

                      setDisplayMonth(
                        (current) =>
                          new Date(
                            current.getFullYear(),
                            monthOption.monthIndex,
                            1,
                          ),
                      );
                      setViewMode("day");
                    }}
                    type="button"
                  >
                    {monthOption.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {viewMode === "year" ? (
            <div className="date-picker-grid date-picker-panel">
              {yearOptions.map((yearOption) => {
                const disabledYear = !yearHasEnabledDay(
                  yearOption,
                  minDate,
                  maxDate,
                );
                const isSelected = displayMonth.getFullYear() === yearOption;

                return (
                  <button
                    className={cn(
                      "date-picker-grid-item",
                      isSelected ? "date-picker-grid-item-selected" : "",
                    )}
                    disabled={disabledYear}
                    key={yearOption}
                    onClick={() => {
                      if (disabledYear) {
                        return;
                      }

                      setDisplayMonth(
                        (current) =>
                          new Date(yearOption, current.getMonth(), 1),
                      );
                      setViewMode("month");
                    }}
                    type="button"
                  >
                    {yearOption}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}

export { DateInput };
