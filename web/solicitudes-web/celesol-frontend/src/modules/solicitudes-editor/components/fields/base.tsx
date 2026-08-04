import { ChevronDown, Pencil, Search, X } from "lucide-react";
import { type CSSProperties, type ReactNode, useId, useState } from "react";

import { Button } from "@/shared/components/ui/button";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";

import type { StyledSelectOption, TabItem } from "../../types";

export function Section({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const contentId = useId();

  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface">
      <header
        className={`bg-background ${
          isExpanded ? "border-b border-border" : ""
        }`}
      >
        <button
          aria-controls={contentId}
          aria-expanded={isExpanded}
          className="flex w-full items-center gap-2 px-3 py-2 text-left"
          onClick={() => setIsExpanded((current) => !current)}
          type="button"
        >
          <ChevronDown
            className={`size-4 text-foreground-secondary transition-transform ${
              isExpanded ? "" : "-rotate-90"
            }`}
          />
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
        </button>
      </header>

      <div
        aria-hidden={!isExpanded}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          isExpanded
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0"
        }`}
        id={contentId}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="p-3 md:p-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

export function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-destructive">
      {" "}
      *
    </span>
  );
}

export function Field({
  children,

  className,

  label,

  required,
}: {
  children: ReactNode;

  className?: string;

  label: string;

  required?: boolean;
}) {
  return (
    <label className={`grid gap-1.5 ${className ?? ""}`}>
      <span className="text-xs font-medium text-foreground-secondary">
        {label}
        {required ? <RequiredMark /> : null}
      </span>

      {children}
    </label>
  );
}

export function SectionTabs<TValue extends string>({
  activeTab,

  onTabChange,

  tabs,
}: {
  activeTab: TValue;

  onTabChange: (tab: TValue) => void;

  tabs: TabItem<TValue>[];
}) {
  return (
    <div className="-mx-3 -mt-3 mb-3 overflow-x-auto border-b border-border px-3 md:-mx-4 md:-mt-4 md:px-4">
      <div className="flex min-w-max gap-4">
        {tabs.map((tab) => {
          const isActive = tab.value === activeTab;

          return (
            <button
              className={`border-b-2 px-0 py-2 text-xs font-medium transition ${
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-foreground-secondary hover:text-foreground"
              }`}
              key={tab.value}
              onClick={() => onTabChange(tab.value)}
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SubsectionTabs<TValue extends string>({
  activeTab,

  onTabChange,

  tabs,
}: {
  activeTab: TValue;

  onTabChange: (tab: TValue) => void;

  tabs: TabItem<TValue>[];
}) {
  return (
    <div className="mb-4">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-foreground-muted">
        Secciones
      </div>
      <div className="overflow-x-auto">
        <div className="flex min-w-max gap-4">
          {tabs.map((tab) => {
            const isActive = tab.value === activeTab;

            return (
              <button
                className={`border-b-2 px-0 py-1 text-xs font-medium transition ${
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-foreground hover:text-foreground"
                }`}
                key={tab.value}
                onClick={() => onTabChange(tab.value)}
                type="button"
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const fieldClassName =
  "flex h-9 w-full min-w-0 rounded-md border border-input-border bg-input-background px-3 py-1 text-sm text-foreground shadow-xs transition outline-none placeholder:text-foreground-muted focus-visible:border-input-focus focus-visible:ring-2 focus-visible:ring-input-focus/20 disabled:cursor-not-allowed disabled:bg-disabled-background disabled:text-disabled-foreground aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20";

export const legacyButtonClassName = "text-foreground-secondary";

export const legacyIconButtonClassName = "text-foreground-muted";

export const legacyFieldClassName =
  "flex h-9 w-full min-w-0 rounded-md border border-input-border bg-input-background px-3 py-1 text-sm text-foreground shadow-xs transition outline-none placeholder:text-foreground-muted focus-visible:border-input-focus focus-visible:ring-2 focus-visible:ring-input-focus/20 disabled:cursor-not-allowed disabled:bg-disabled-background disabled:text-disabled-foreground aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20";

export function LegacyToolbarButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <Button
      className={legacyButtonClassName}
      disabled={disabled}
      onClick={onClick}
      size="sm"
      type="button"
      variant="outline"
    >
      {children}
    </Button>
  );
}

export function LegacyIconButton({
  children,
  className,
  disabled,
  onClick,
  title,
  type = "button",
}: {
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  type?: "button" | "reset" | "submit";
}) {
  return (
    <Button
      className={`${legacyIconButtonClassName} ${className ?? ""}`}
      disabled={disabled}
      onClick={onClick}
      size="icon-sm"
      title={title}
      type={type}
      variant="outline"
    >
      {children}
    </Button>
  );
}

export function LegacyField({
  children,
  className,
  label,
  required,
}: {
  children: ReactNode;
  className?: string;
  label: string;
  required?: boolean;
}) {
  return (
    <label
      className={`grid grid-cols-[13.5rem_minmax(0,1fr)] items-center gap-2 ${className ?? ""}`}
    >
      <span className="text-xs font-medium text-foreground-secondary">
        {label}
        {required ? <RequiredMark /> : null}
      </span>
      {children}
    </label>
  );
}

export function LegacyInputWithActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-1">
      {children}
      <LegacyIconButton className="text-foreground-muted">
        <X className="size-4" />
      </LegacyIconButton>
      <LegacyIconButton className="text-foreground-secondary">
        <Pencil className="size-4" />
      </LegacyIconButton>
      <LegacyIconButton className="text-foreground-secondary">
        <ChevronDown className="size-4" />
      </LegacyIconButton>
    </div>
  );
}

export function ModalSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const contentId = useId();

  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface">
      <header
        className={`bg-background ${
          isExpanded ? "border-b border-border" : ""
        }`}
      >
        <button
          aria-controls={contentId}
          aria-expanded={isExpanded}
          className="flex w-full items-center gap-2 px-3 py-2 text-left"
          onClick={() => setIsExpanded((current) => !current)}
          type="button"
        >
          <ChevronDown
            className={`size-4 text-foreground-secondary transition-transform ${
              isExpanded ? "" : "-rotate-90"
            }`}
          />
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
        </button>
      </header>
      <div
        aria-hidden={!isExpanded}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          isExpanded
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0"
        }`}
        id={contentId}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="p-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

export function ModalField({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <label className={`grid gap-1.5 ${className ?? ""}`}>
      <span className="text-xs font-medium text-foreground-secondary">
        {label}
      </span>
      {children}
    </label>
  );
}

export function StyledSelect({
  ariaLabel,
  className,
  disabled,
  emptyOptionLabel,
  invalid,
  onChange,
  options,
  placeholder = "Seleccione una opcion",
  searchable = false,
  searchPlaceholder = "Buscar...",
  style,
  value,
}: {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  emptyOptionLabel?: string;
  invalid?: boolean;
  onChange: (value: string) => void;
  options: StyledSelectOption[];
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  style?: CSSProperties;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const selectedOption = options.find((option) => option.value === value);
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const visibleOptions =
    searchable && normalizedSearchTerm
      ? options.filter((option) =>
          option.label.toLowerCase().includes(normalizedSearchTerm),
        )
      : options;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setSearchTerm("");
    }

    setOpen(nextOpen);
  }

  return (
    <PopoverRoot modal onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-invalid={invalid}
          aria-label={ariaLabel}
          className={`${legacyFieldClassName} items-center justify-between gap-2 text-left disabled:opacity-60 ${className ?? ""}`}
          disabled={disabled}
          style={style}
          type="button"
        >
          <span
            className={
              selectedOption ? "truncate" : "truncate text-foreground-muted"
            }
          >
            {selectedOption?.label ?? placeholder}
          </span>
          <ChevronDown className="size-4 shrink-0 text-foreground-secondary" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-h-72 w-[var(--radix-popover-trigger-width)] overflow-y-auto p-1">
        {searchable ? (
          <div className="sticky top-0 z-10 -mx-1 -mt-1 mb-1 flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
            <Search className="size-4 shrink-0 text-foreground-secondary" />
            <input
              autoFocus
              className="w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-muted"
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={searchPlaceholder}
              value={searchTerm}
            />
          </div>
        ) : null}
        {emptyOptionLabel ? (
          <button
            className={`flex min-h-9 w-full items-center rounded-md px-3 py-2 text-left text-sm transition ${
              value === ""
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-background"
            }`}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            type="button"
          >
            {emptyOptionLabel}
          </button>
        ) : null}
        {visibleOptions.length > 0 ? (
          visibleOptions.map((option) => {
            const isSelected = option.value === value;
            const optionButton = (
              <button
                className={`flex min-h-9 w-full items-center rounded-md px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent ${
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-background"
                }`}
                disabled={option.disabled}
                onClick={() => {
                  if (option.disabled) {
                    return;
                  }

                  onChange(option.value);
                  setOpen(false);
                }}
                type="button"
              >
                {option.label}
              </button>
            );

            if (option.disabled && option.disabledReason) {
              return (
                <TooltipProvider delayDuration={200} key={option.value}>
                  <TooltipRoot>
                    <TooltipTrigger asChild>
                      <span className="block w-full">{optionButton}</span>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {option.disabledReason}
                    </TooltipContent>
                  </TooltipRoot>
                </TooltipProvider>
              );
            }

            return <div key={option.value}>{optionButton}</div>;
          })
        ) : (
          <div className="px-3 py-2 text-sm text-foreground-muted">
            {searchable && normalizedSearchTerm
              ? "Sin coincidencias"
              : "Sin opciones disponibles"}
          </div>
        )}
      </PopoverContent>
    </PopoverRoot>
  );
}

export function StaticStyledSelect({
  defaultValue = "",
  options,
  placeholder,
}: {
  defaultValue?: string;
  options: StyledSelectOption[];
  placeholder?: string;
}) {
  const [value, setValue] = useState(defaultValue);

  return (
    <StyledSelect
      onChange={setValue}
      options={options}
      placeholder={placeholder}
      value={value}
    />
  );
}
