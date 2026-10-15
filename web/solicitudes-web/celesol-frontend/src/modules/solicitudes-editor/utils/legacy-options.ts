import { formatMoneyAmount } from "@/shared/utils/money-format";

import type { LegacyOption } from "../types";

export function legacyValueToString(
  value: boolean | null | number | string | undefined,
) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

// Montos que llegan del legado para cargar en un campo de dinero. Con
// legacyValueToString, 850000.5 quedaria "850000.5", y el campo lee ese punto
// como separador de miles: terminaria mostrando $8.500.005.
export function legacyMoneyToString(
  value: boolean | null | number | string | undefined,
) {
  if (typeof value === "number") {
    return formatMoneyAmount(value);
  }

  if (typeof value === "string" && value.trim() !== "") {
    const numero = Number(value);

    // Si no es un numero comun (por ejemplo, ya viene "850.000,50"), se deja
    // como esta: el campo de dinero ya entiende ese formato.
    return Number.isFinite(numero) ? formatMoneyAmount(numero) : value;
  }

  return legacyValueToString(value);
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
