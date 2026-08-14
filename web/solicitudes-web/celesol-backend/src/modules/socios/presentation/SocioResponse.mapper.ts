import type { Socio } from "../domain/entities/Socio.entity";
import { formatCivilDate } from "../application/services/SocioCivilDate";
import type {
  PersonaFisicaResponse,
  PersonaJuridicaResponse,
  SocioResponse,
} from "./SocioResponse";

export function toSocioResponse(
  socio: Socio,
): PersonaFisicaResponse | PersonaJuridicaResponse {
  if (socio.tipoPersona === "FISICA") {
    return {
      apellido: socio.apellido,
      celular: socio.celular,
      createdAt: socio.createdAt.toISOString(),
      cuit: socio.cuit,
      domicilioCalle: socio.domicilioCalle,
      domicilioCodigoPostal: socio.domicilioCodigoPostal,
      domicilioLocalidad: socio.domicilioLocalidad,
      domicilioNroPuerta: socio.domicilioNroPuerta,
      email: socio.email,
      fechaDeNacimiento: formatCivilDate(socio.fechaDeNacimiento),
      id: socio.id,
      nombre: socio.nombre,
      nroDocumento: socio.nroDocumento,
      nroSocioLegacy: socio.nroSocioLegacy,
      sexo: socio.sexo,
      tipoDocumento: socio.tipoDocumento,
      tipoPersona: "FISICA",
      updatedAt: socio.updatedAt.toISOString(),
    };
  }

  return {
    celular: socio.celular,
    createdAt: socio.createdAt.toISOString(),
    cuit: socio.cuit,
    domicilioCalle: socio.domicilioCalle,
    domicilioCodigoPostal: socio.domicilioCodigoPostal,
    domicilioLocalidad: socio.domicilioLocalidad,
    domicilioNroPuerta: socio.domicilioNroPuerta,
    email: socio.email,
    id: socio.id,
    nroSocioLegacy: socio.nroSocioLegacy,
    razonSocial: socio.razonSocial,
    tipoPersona: "JURIDICA",
    updatedAt: socio.updatedAt.toISOString(),
  };
}

export function toSocioListResponse(socios: Socio[]): SocioResponse[] {
  return socios.map((socio) => toSocioResponse(socio));
}
