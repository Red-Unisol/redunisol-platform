import type { ConsultarCredixsaGateway } from "../../infrastructure/services/ConsultarCredixsaGateway";

type TitularParaCredixsa = {
  apellidoDenominacion: string;
  cuit?: string | null;
  nombre?: string | null;
  nroDocumento?: string | null;
};

type Dependencies = {
  gateway: Pick<ConsultarCredixsaGateway, "consultar">;
};

/**
 * Dispara la consulta a CredixSA al crear una solicitud, para que el informe
 * este cacheado cuando lo pida el analista.
 *
 * El orden de preferencia importa: la cache de CredixSA se indexa por CUIL de
 * 11 digitos, asi que consultar con un documento de 8 guarda el informe solo
 * bajo la clave por nombre. Una consulta posterior por CUIL no lo encuentra y
 * vuelve a scrapear -- la consulta anticipada se desaprovecha justo donde mas
 * sirve.
 */
export class ConsultarCredixsaAlCrearSolicitud {
  private readonly gateway: Pick<ConsultarCredixsaGateway, "consultar">;

  constructor(dependencies: Dependencies) {
    this.gateway = dependencies.gateway;
  }

  async execute(solicitudId: string, titular: TitularParaCredixsa) {
    await this.gateway.consultar({
      cuit: elegirIdentificador(titular),
      nombre: armarNombre(titular),
      solicitudId,
    });
  }
}

// 1) CUIL, 2) documento, 3) ninguno -- y ahi manda el nombre solo.
function elegirIdentificador(titular: TitularParaCredixsa): string {
  const cuit = soloDigitos(titular.cuit);

  if (cuit.length === 11) {
    return cuit;
  }

  const documento = soloDigitos(titular.nroDocumento);

  return documento || cuit;
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
