import { InvalidSocioRequestError } from "../../domain/socios-errors";

const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseCivilDate(input: string): Date {
  const trimmed = input.trim();

  if (!CIVIL_DATE_PATTERN.test(trimmed)) {
    throw new InvalidSocioRequestError("Fecha de nacimiento invalida.");
  }

  const [yearToken, monthToken, dayToken] = trimmed.split("-");
  const year = Number.parseInt(yearToken, 10);
  const month = Number.parseInt(monthToken, 10);
  const day = Number.parseInt(dayToken, 10);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new InvalidSocioRequestError("Fecha de nacimiento invalida.");
  }

  return date;
}

export function formatCivilDate(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");

  return `${year}-${month}-${day}`;
}
