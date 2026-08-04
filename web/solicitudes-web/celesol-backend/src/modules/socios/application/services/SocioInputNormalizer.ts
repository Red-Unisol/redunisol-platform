import { InvalidSocioRequestError } from "../../domain/socios-errors";

function removeCommonSeparators(value: string) {
  return value.replaceAll(".", "").replaceAll(" ", "").replaceAll("-", "");
}

export function normalizeCuit(value: string): string {
  const normalized = removeCommonSeparators(value.trim());

  if (!/^\d{11}$/.test(normalized)) {
    throw new InvalidSocioRequestError("Cuit invalido.");
  }

  return normalized;
}

export function normalizeDocumento(value: string): string {
  return removeCommonSeparators(value.trim()).toUpperCase();
}
