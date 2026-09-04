// La linea que elige el vendedor y la que espera el legado al crear el prestamo
// viven en DOS TABLAS DISTINTAS de Vimarx, cada una con su propia numeracion:
//
//   PreSolicitud.Module.LineaPrestamoPresolicitud  -> Oid  (lo que se le muestra
//                                                           al vendedor y lo que
//                                                           guardamos en la solicitud)
//   F.Module.Cuentas.Prestamos.LineaPrestamo       -> ID   (lo que espera el campo
//                                                           LineaPrestamo de
//                                                           /api/Simulador/CrearPrestamo)
//
// Los numeros coinciden solo por casualidad. Medido contra el ambiente real: de
// 143 lineas vigentes, 131 tienen numero distinto, y la diferencia no sigue
// ningun patron (+33, 0, -1, +1 segun la linea). Mandar el Oid tal cual hace que
// el legado cree el prestamo con OTRA linea -- otra tasa, otras condiciones -- y
// no devuelve ningun error: el prestamo queda mal y parece bien.
//
// Vimarx expone la relacion entre las dos: la linea de prestamo tiene la
// propiedad LineaSolicitud, que apunta a la linea de presolicitud de la que
// salio. Eso es lo que resuelve esta interfaz.
export type LineaPrestamoLegacyIdResolver = {
  /**
   * Devuelve el ID de F.Module.Cuentas.Prestamos.LineaPrestamo que corresponde
   * al Oid de presolicitud recibido, o null si no se puede determinar con
   * certeza (no existe la contraparte, o hay mas de una candidata).
   *
   * Ante la duda devuelve null a proposito: es preferible no crear el prestamo
   * a crearlo con la linea equivocada.
   */
  resolveByPresolicitudOid(presolicitudOid: string): Promise<string | null>;
};
