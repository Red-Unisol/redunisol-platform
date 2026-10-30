import { useState, type CSSProperties } from "react";
import {
  Controller,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";
import {
  defaultCountries,
  parseCountry,
  PhoneInput,
} from "react-international-phone";
import "react-international-phone/style.css";

import { cn } from "@/shared/utils/cn";

const bundledFlagUrls = import.meta.glob<string>(
  "../../../../node_modules/flag-icons/flags/4x3/*.svg",
  { eager: true, query: "?url", import: "default" },
);
const flagUrlsByCountry = Object.fromEntries(
  Object.entries(bundledFlagUrls).map(([filename, url]) => [
    filename.slice(filename.lastIndexOf("/") + 1, -4),
    url,
  ]),
);
// Supply every supported flag explicitly so the phone library never falls back
// to its external CDN, including flags inside the initially closed dropdown.
const bundledFlags = defaultCountries.map((country) => {
  const { iso2 } = parseCountry(country);
  const src = flagUrlsByCountry[iso2];
  if (!src) throw new Error(`Missing bundled country flag: ${iso2}`);
  return { iso2, src };
});

export function InternationalPhoneField<TFieldValues extends FieldValues>({
  control,
  inputAutoComplete,
  name,
  placeholder = "341 720 4225",
}: {
  control: Control<TFieldValues>;
  inputAutoComplete?: string;
  name: Path<TFieldValues>;
  placeholder?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <PhoneInput
          flags={bundledFlags}
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
          placeholder={placeholder}
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
      flags={bundledFlags}
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
