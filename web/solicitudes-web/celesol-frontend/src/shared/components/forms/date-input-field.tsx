import {
  Controller,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { DateInput } from "@/shared/components/ui/date-input";

export function DateInputField<TFieldValues extends FieldValues>({
  className,
  control,
  invalid,
  max,
  min,
  name,
}: {
  className?: string;
  control: Control<TFieldValues>;
  invalid?: boolean;
  max?: string;
  min?: string;
  name: Path<TFieldValues>;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <DateInput
          aria-invalid={invalid || undefined}
          className={className}
          max={max}
          min={min}
          name={field.name}
          onBlur={field.onBlur}
          onChange={field.onChange}
          value={field.value}
        />
      )}
    />
  );
}
