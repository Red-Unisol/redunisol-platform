import type { CSSProperties } from "react";

// Formato común de las listas de solicitudes (Precarga, Recientes).

export const LISTA_HEADER_CELL =
  "sticky top-0 z-10 bg-surface px-3 py-3 text-left text-xs font-semibold whitespace-nowrap text-foreground-secondary";

export function formatFechaLista(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatMontoLista(value: number | string | null) {
  if (value === null || value === "") {
    return "";
  }

  const numero = typeof value === "number" ? value : Number(value);

  if (Number.isNaN(numero)) {
    return String(value);
  }

  // Sin decimales si es redondo; si tiene centavos, siempre los dos.
  const decimales = Number.isInteger(numero) ? 0 : 2;

  return new Intl.NumberFormat("es-AR", {
    currency: "ARS",
    maximumFractionDigits: decimales,
    minimumFractionDigits: decimales,
    style: "currency",
  }).format(numero);
}

export function buildSocioLista(apellido: string | null, nombre: string | null) {
  return [apellido?.trim(), nombre?.trim()].filter(Boolean).join(", ");
}

// Los colores de fila los define el backend (reglas de permisos por estado).
export function buildRowStyleLista(
  appearance?: {
    backgroundColor?: string | null;
    textColor?: string | null;
  } | null,
): CSSProperties | undefined {
  if (!appearance?.backgroundColor && !appearance?.textColor) {
    return undefined;
  }

  return {
    backgroundColor: appearance.backgroundColor ?? undefined,
    color: appearance.textColor ?? undefined,
  };
}
