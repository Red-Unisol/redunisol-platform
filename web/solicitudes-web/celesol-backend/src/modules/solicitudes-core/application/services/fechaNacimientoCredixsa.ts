/**
 * Fecha de nacimiento que trae el informe de CredixSA. Es la verdadera: la que
 * cargo el vendedor queda hasta que CredixSA trae la suya y la pisa.
 *
 * Viene en persona.fecha_nacimiento ("31/07/1991") o, si falta, dentro de
 * persona.edad ("35 (31/07/1991)"), igual que la lee la pestaña CredixSA.
 * Solo se usa si el documento del informe es el del titular: con un DNI o
 * CUIT mal cargado, el informe puede ser de otra persona.
 */
type Persona = {
  cuit?: unknown;
  documento?: unknown;
  edad?: unknown;
  fecha_nacimiento?: unknown;
};

function soloDigitos(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\D/g, "")
    : "";
}

function parsearFecha(texto: string): Date | null {
  const dma = texto.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = texto.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  const [anio, mes, dia] = dma
    ? [Number(dma[3]), Number(dma[2]), Number(dma[1])]
    : iso
      ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
      : [NaN, NaN, NaN];

  if (!Number.isInteger(anio) || anio < 1900 || mes < 1 || mes > 12) {
    return null;
  }

  const fecha = new Date(Date.UTC(anio, mes - 1, dia));

  // Descarta fechas que no existen (31/02) y fechas futuras.
  return fecha.getUTCDate() === dia && fecha.getTime() <= Date.now()
    ? fecha
    : null;
}

export function fechaNacimientoDelInforme(
  informe: unknown,
  titular: { cuit?: string | null; nroDocumento?: string | null },
): Date | null {
  if (!informe || typeof informe !== "object") {
    return null;
  }

  const persona = (informe as { persona?: unknown }).persona;

  if (!persona || typeof persona !== "object") {
    return null;
  }

  const datos = persona as Persona;
  const documentoInforme = soloDigitos(datos.documento);
  const cuitInforme = soloDigitos(datos.cuit);
  const documentoTitular = soloDigitos(titular.nroDocumento).replace(/^0+/, "");
  const cuitTitular = soloDigitos(titular.cuit);
  const esElTitular =
    (documentoTitular !== "" &&
      documentoInforme.replace(/^0+/, "") === documentoTitular) ||
    (cuitTitular !== "" && cuitInforme === cuitTitular);

  if (!esElTitular) {
    return null;
  }

  if (typeof datos.fecha_nacimiento === "string" && datos.fecha_nacimiento) {
    return parsearFecha(datos.fecha_nacimiento);
  }

  const enEdad =
    typeof datos.edad === "string" ? datos.edad.match(/\(([^)]+)\)/) : null;

  return enEdad ? parsearFecha(enEdad[1]) : null;
}
