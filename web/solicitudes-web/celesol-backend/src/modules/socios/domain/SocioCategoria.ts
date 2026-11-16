// Categoria con la que se da de alta el socio en Vimarx
// (Socios.Module.CategoriasSocios). Regla de la mutual: todo socio entra como
// ADHERENTE CONVENIO, salvo los de AMEJUCA y Mudon, que tienen la suya.
// Los IDs son los que se usaron en las altas del ultimo año (hay categorias
// repetidas con el mismo nombre: AMEJUCA 64, MUDON 72 y 77, sin uso) y son
// iguales en Fapi y en FapiTest (verificado el 12/11/2026).
export const SOCIO_CATEGORIAS = [
  "ADHERENTE_CONVENIO",
  "AMEJUCA",
  "MUDON",
] as const;

export type SocioCategoria = (typeof SOCIO_CATEGORIAS)[number];

export const SOCIO_CATEGORIA_POR_DEFECTO: SocioCategoria = "ADHERENTE_CONVENIO";

export const SOCIO_CATEGORIA_ID_VIMARX: Record<SocioCategoria, number> = {
  ADHERENTE_CONVENIO: 9,
  AMEJUCA: 48,
  MUDON: 78,
};
