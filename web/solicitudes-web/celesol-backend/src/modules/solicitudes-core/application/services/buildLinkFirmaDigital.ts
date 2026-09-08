const FINALIZAR_FIRMA_DIGITAL_BASE_URL =
  "https://redunisol.com.ar/finalizar.php";

// El parametro "linea" no es la descripcion de la linea de prestamo sino el
// codigo de la mutual (amejuca, muci, caja...), que es la clave con la que
// finalizar.php elige el flow y el documento de Metamap que se van a firmar.
// Mandando la descripcion no coincide ninguna clave y todos terminan firmando
// el documento por defecto, sin que nada avise.
export function buildLinkFirmaDigital(
  legacyOid: string,
  codigoMutual: string | null,
): string {
  const params = new URLSearchParams();

  // Sin codigo se omite el parametro. finalizar.php ya cae solo en el documento
  // por defecto, que es lo mismo que pasaria mandandolo vacio.
  if (codigoMutual) {
    params.set("linea", codigoMutual);
  }

  params.set("ntrans", "0");
  params.set("sol", legacyOid);

  return `${FINALIZAR_FIRMA_DIGITAL_BASE_URL}?${params.toString()}`;
}
