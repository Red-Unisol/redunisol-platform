export type TitularParaCredixsa = {
  // Nullable porque asi lo guarda la solicitud: al crearla viene siempre, pero
  // el registro persistido admite null.
  apellidoDenominacion?: string | null;
  cuit?: string | null;
  nombre?: string | null;
  nroDocumento?: string | null;
};

export type ConsultaCredixsa = {
  /** CUIL de 11 digitos, documento, o vacio si el titular no tiene ninguno. */
  cuit: string;
  nombre: string;
};

/**
 * Con que datos consultarle a CredixSA por una persona.
 *
 * El orden importa y no es arbitrario: la cache de CredixSA se indexa por CUIL
 * de 11 digitos, asi que consultar con un documento de 8 guarda el informe solo
 * bajo la clave por nombre. Una consulta posterior por CUIL no lo encuentra y
 * vuelve a scrapear.
 *
 * Vive aparte para que la consulta que se dispara al crear la solicitud y la
 * que hace la pestaña usen exactamente el mismo criterio. Si difirieran,
 * cada una guardaria el informe bajo una clave distinta y la cache no serviria
 * de nada.
 */
export function buildConsultaCredixsa(
  titular: TitularParaCredixsa,
): ConsultaCredixsa {
  return {
    cuit: elegirIdentificador(titular),
    nombre: armarNombre(titular),
  };
}

// 1) CUIL, 2) documento, 3) ninguno -- y ahi va el nombre solo.
function elegirIdentificador(titular: TitularParaCredixsa): string {
  const cuit = soloDigitos(titular.cuit);

  if (cuit.length === 11) {
    return cuit;
  }

  return soloDigitos(titular.nroDocumento) || cuit;
}

function armarNombre(titular: TitularParaCredixsa): string {
  return [titular.apellidoDenominacion, titular.nombre]
    .map((parte) => (parte ?? "").trim())
    .filter((parte) => parte.length > 0)
    .join(" ");
}

function soloDigitos(value: string | null | undefined): string {
  return (value ?? "").replace(/\D+/g, "");
}
