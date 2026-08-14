import { useState, type CSSProperties } from "react";
import {
  Controller,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { Input } from "@/shared/components/ui/input";
import { formatMoneyValue } from "@/shared/utils/money-format";

const defaultMoneyInputClassName =
  "flex h-9 w-full min-w-0 rounded-md border border-input-border bg-input-background px-3 py-1 text-sm text-foreground shadow-xs transition outline-none placeholder:text-foreground-muted focus-visible:border-input-focus focus-visible:ring-2 focus-visible:ring-input-focus/20 disabled:cursor-not-allowed disabled:bg-disabled-background disabled:text-disabled-foreground aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20";

export function MoneyInputField<TFieldValues extends FieldValues>({
  className,
  control,
  invalid,
  name,
  placeholder,
  validate,
}: {
  className?: string;
  control: Control<TFieldValues>;
  invalid?: boolean;
  name: Path<TFieldValues>;
  placeholder?: string;
  validate?: (value: string) => string | true;
}) {
  return (
    <Controller
      control={control}
      name={name}
      rules={validate ? { validate } : undefined}
      render={({ field }) => (
        <input
          aria-invalid={invalid || undefined}
          className={className ?? defaultMoneyInputClassName}
          inputMode="numeric"
          name={field.name}
          onBlur={field.onBlur}
          onChange={(event) =>
            field.onChange(formatMoneyValue(event.target.value))
          }
          placeholder={placeholder}
          value={formatMoneyValue(field.value)}
        />
      )}
    />
  );
}

export function StaticMoneyInput({
  className,
  defaultValue = "",
  disabled = false,
  onChange,
  style,
  value: controlledValue,
}: {
  className?: string;
  defaultValue?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  style?: CSSProperties;
  value?: string;
}) {
  const [uncontrolledValue, setUncontrolledValue] = useState(
    formatMoneyValue(defaultValue),
  );
  const value = controlledValue ?? uncontrolledValue;

  return (
    <Input
      className={className}
      disabled={disabled}
      inputMode="numeric"
      onChange={(event) => {
        const formattedValue = formatMoneyValue(event.target.value);
        if (controlledValue === undefined) {
          setUncontrolledValue(formattedValue);
        }
        onChange?.(formattedValue);
      }}
      style={style}
      value={value}
    />
  );
}
