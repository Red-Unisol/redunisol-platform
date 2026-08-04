import { useState, type CSSProperties } from "react";
import {
  Controller,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";
import { PhoneInput } from "react-international-phone";
import "react-international-phone/style.css";

import { cn } from "@/shared/utils/cn";

export function InternationalPhoneField<TFieldValues extends FieldValues>({
  control,
  inputAutoComplete,
  name,
}: {
  control: Control<TFieldValues>;
  inputAutoComplete?: string;
  name: Path<TFieldValues>;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <PhoneInput
          allowMaskOverflow
          className="celesol-phone-input"
          defaultCountry="ar"
          disableCountryGuess
          disableDialCodePrefill
          disableFormatting
          inputClassName="celesol-phone-input__field"
          inputProps={{ autoComplete: inputAutoComplete, name: field.name }}
          onBlur={field.onBlur}
          onChange={(phone) => field.onChange(phone)}
          placeholder="341 720 4225"
          value={field.value}
        />
      )}
    />
  );
}

export function StaticInternationalPhoneField({
  className,
  disabled = false,
  inputClassName,
  inputStyle,
  invalid,
  onChange,
  value: controlledValue,
}: {
  className?: string;
  disabled?: boolean;
  inputClassName?: string;
  inputStyle?: CSSProperties;
  invalid?: boolean;
  onChange?: (value: string) => void;
  value?: string;
}) {
  const [uncontrolledValue, setUncontrolledValue] = useState("");
  const value = controlledValue ?? uncontrolledValue;

  return (
    <PhoneInput
      allowMaskOverflow
      className={cn(
        "celesol-phone-input",
        invalid ? "celesol-phone-input--invalid" : "",
        className,
      )}
      defaultCountry="ar"
      disableCountryGuess
      disableDialCodePrefill
      disableFormatting
      disabled={disabled}
      inputClassName={cn("celesol-phone-input__field", inputClassName)}
      inputStyle={inputStyle}
      onChange={(phone) => {
        if (controlledValue === undefined) {
          setUncontrolledValue(phone);
        }
        onChange?.(phone);
      }}
      placeholder="341 720 4225"
      value={value}
    />
  );
}
