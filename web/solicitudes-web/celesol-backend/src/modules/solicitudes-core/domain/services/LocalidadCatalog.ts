// Localidades de Vimarx (ClasesBase.Localidad). La implementacion es el
// catalogo en memoria del modulo de socios: una sola copia para toda la app.
export type LocalidadCatalog = {
  findById(id: string): Promise<{ id: string; nombre: string } | null>;
};
