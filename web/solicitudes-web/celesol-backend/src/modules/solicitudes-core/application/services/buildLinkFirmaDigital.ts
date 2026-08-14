const FINALIZAR_FIRMA_DIGITAL_BASE_URL =
  "https://redunisol.com.ar/finalizar.php";

export function buildLinkFirmaDigital(
  legacyOid: string,
  lineaPrestamoDescripcion: string,
): string {
  const params = new URLSearchParams({
    linea: lineaPrestamoDescripcion,
    ntrans: "0",
    sol: legacyOid,
  });

  return `${FINALIZAR_FIRMA_DIGITAL_BASE_URL}?${params.toString()}`;
}
