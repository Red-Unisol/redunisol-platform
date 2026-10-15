export type ListSociosDto = {
  /** Solo el socio con este DNI o CUIL/CUIT exacto (busqueda de Vendedores). */
  documentoExacto?: string;
  limit: number;
  offset: number;
  search?: string;
};
