import type { SocioFormState } from "@/modules/socios/components/socio-form-dialog";
import type { SolicitudCoreTitularResponse } from "@/modules/solicitudes/types/solicitudes-core";

export function buildSocioPrefillFromTitular(
  titular: SolicitudCoreTitularResponse,
): Partial<SocioFormState> {
  const apellidoDenominacion = titular.apellidoDenominacion ?? "";

  return {
    apellido: apellidoDenominacion,
    celular: titular.celular ?? "",
    cuit: titular.cuit ?? "",
    domicilioCalle: titular.domicilioCalle ?? "",
    domicilioLocalidad: titular.localidad ?? "",
    domicilioNroPuerta: titular.nroPuerta ?? "",
    email: titular.email ?? "",
    fechaDeNacimiento: titular.fechaNacimiento ?? "",
    nombre: titular.nombre ?? "",
    nroDocumento: titular.nroDocumento ?? "",
    razonSocial: apellidoDenominacion,
    sexo: titular.sexo ?? "",
    tipoDocumento: titular.tipoDocumento ?? "DNI",
    tipoPersona: "FISICA",
  };
}
