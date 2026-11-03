// Estilo comun de las tablas del detalle (Adjuntos, Prestamos, Solicitudes,
// Refinanciacion, Cancelaciones): sin lineas verticales, encabezado suave y
// una sola jerarquia de texto.
export const TABLA = {
  // Barra de acciones arriba de la tabla (boton principal a la derecha).
  acciones: "flex flex-wrap items-center justify-end gap-2",
  celda: "px-3 py-3 align-top",
  celdaMonto: "px-3 py-3 align-top font-semibold tabular-nums text-foreground",
  celdaPrincipal: "px-3 py-3 align-top font-medium text-foreground",
  celdaSecundaria: "px-3 py-3 align-top text-foreground-secondary",
  contenedor: "overflow-x-auto rounded-lg border border-border",
  encabezado:
    "border-b border-border bg-[#f6f8f7] text-left text-xs text-foreground-secondary",
  fila: "border-t border-border-soft transition-colors first:border-t-0 hover:bg-[#f6f8f7]",
  // Botones de icono de cada fila.
  icono: "text-foreground-secondary hover:text-marino",
  iconoPeligro:
    "text-foreground-secondary hover:bg-destructive/10 hover:text-destructive",
  th: "px-3 py-2.5 font-semibold whitespace-nowrap",
  vacio: "px-3 py-6 text-center text-sm text-foreground-secondary",
} as const;
