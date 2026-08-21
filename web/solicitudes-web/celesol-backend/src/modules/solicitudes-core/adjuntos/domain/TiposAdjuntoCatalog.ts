export const TIPO_ADJUNTO_VALUES = [
  "DNI",
  "Recibo de Sueldo",
  "Constancia de CBU",
  "Documentación Adicional",
] as const;

export type TipoAdjuntoValue = (typeof TIPO_ADJUNTO_VALUES)[number];

export const TIPOS_ADJUNTO_CATALOG: { label: string; value: TipoAdjuntoValue }[] =
  TIPO_ADJUNTO_VALUES.map((value) => ({ label: value, value }));

export const MAX_ADJUNTOS_LOTE = 10;
