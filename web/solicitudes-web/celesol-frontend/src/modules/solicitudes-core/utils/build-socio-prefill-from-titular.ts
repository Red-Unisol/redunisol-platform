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
    // El alta del socio usa el ID de Vimarx. Las solicitudes anteriores al
    // 12/11/2026 solo tienen el nombre: ahi el vendedor la elige de la lista
    // (ver localidadSugerida).
    domicilioLocalidad: titular.localidadId ?? "",
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
