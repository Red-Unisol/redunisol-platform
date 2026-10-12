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
  transform,
}: {
  className?: string;
  control: Control<TFieldValues>;
  invalid?: boolean;
  name: Path<TFieldValues>;
  placeholder?: string;
  validate?: (value: string) => string | true;
  transform?: (value: string) => string;
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
          inputMode="decimal"
          name={field.name}
          onBlur={field.onBlur}
          onChange={(event) => {
            const input = event.target;
            const raw = input.value;
            const caret = input.selectionStart;
            field.onChange(
              transform
                ? transform(formatMoneyValue(raw))
                : formatMoneyValue(raw),
            );
            preserveMoneyCaret(input, raw, caret);
          }}
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
      inputMode="decimal"
      onChange={(event) => {
        const input = event.target;
        const raw = input.value;
        const caret = input.selectionStart;
        const formattedValue = formatMoneyValue(raw);
        if (controlledValue === undefined) {
          setUncontrolledValue(formattedValue);
        }
        onChange?.(formattedValue);
        preserveMoneyCaret(input, raw, caret);
      }}
      style={style}
      value={value}
    />
  );
}

// Ancla el cursor a los dígitos/decimales editados cuando cambian los separadores.
function preserveMoneyCaret(
  input: HTMLInputElement,
  raw: string,
  caret: number | null,
) {
  if (caret === null) return;
  const count = raw.slice(0, caret).replace(/[^\d,]/g, "").length;
  requestAnimationFrame(() => {
    if (document.activeElement !== input) return;
    let seen = 0;
    let target = input.value.length;
    for (let index = 0; index < input.value.length; index++) {
      if (/^[\d,]$/.test(input.value[index])) {
        seen++;
        if (seen >= count) {
          target = count === 0 ? index : index + 1;
          break;
        }
      }
    }
    input.setSelectionRange(target, target);
  });
}
