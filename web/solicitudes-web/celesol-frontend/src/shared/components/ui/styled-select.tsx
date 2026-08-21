import { ChevronDown } from "lucide-react";
import { useState } from "react";

import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { cn } from "@/shared/utils/cn";

export type StyledSelectOption = {
  label: string;
  value: string;
};

export type StyledSelectProps = {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  options: StyledSelectOption[];
  placeholder?: string;
  value: string;
};

export function StyledSelect({
  ariaLabel,
  className,
  disabled,
  onChange,
  options,
  placeholder = "Seleccione una opción",
  value,
}: StyledSelectProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value);

  return (
    <PopoverRoot modal onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={ariaLabel}
          className={cn(
            "flex h-8 min-w-0 items-center justify-between gap-2 rounded-md border border-input-border bg-input-background px-2.5 py-1 text-left text-sm text-foreground shadow-xs transition outline-none focus-visible:border-input-focus focus-visible:ring-2 focus-visible:ring-input-focus/20 disabled:cursor-not-allowed disabled:opacity-60",
            className,
          )}
          disabled={disabled}
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
        {options.length > 0 ? (
          options.map((option) => {
            const isSelected = option.value === value;

            return (
              <button
                className={cn(
                  "flex min-h-9 w-full items-center rounded-md px-3 py-2 text-left text-sm transition",
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-background",
                )}
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                type="button"
              >
                {option.label}
              </button>
            );
          })
        ) : (
          <div className="px-3 py-2 text-sm text-foreground-muted">
            Sin opciones disponibles
          </div>
        )}
      </PopoverContent>
    </PopoverRoot>
  );
}
