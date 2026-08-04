import type { LegacyOption } from "../types";

export function legacyValueToString(
  value: boolean | null | number | string | undefined,
) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

export function getLegacyOptionsWithFallback(
  options: LegacyOption[],

  selectedValue: string,
) {
  if (
    !selectedValue ||
    options.some((option) => option.value === selectedValue)
  ) {
    return options;
  }

  return [
    ...options,

    {
      label: `Código legacy: ${selectedValue}`,

      value: selectedValue,
    },
  ];
}
