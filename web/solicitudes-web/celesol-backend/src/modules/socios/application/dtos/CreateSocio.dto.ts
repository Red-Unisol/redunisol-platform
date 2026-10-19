// Datos del convenio que Vimarx guarda en SocAux del socio.
export type CreateSocioSocAuxDto = {
  beneficio?: string;
  caja40?: number;
  convAux?: number;
};

export type CreateSocioDto =
  | {
      tipoPersona: "FISICA";
      apellido: string;
      celular?: string;
      cuit: string;
      domicilioCalle: string;
      domicilioCodigoPostal?: string;
      domicilioLocalidad: string;
      domicilioNroPuerta?: string;
      email?: string;
      fechaDeNacimiento: string;
      nombre: string;
      nroDocumento: string;
      observaciones?: string;
      sexo: string;
      socAux?: CreateSocioSocAuxDto;
      tipoDocumento: string;
    }
  | {
      tipoPersona: "JURIDICA";
      celular?: string;
      cuit: string;
      domicilioCalle: string;
      domicilioCodigoPostal?: string;
      domicilioLocalidad: string;
      domicilioNroPuerta?: string;
      email?: string;
      observaciones?: string;
      razonSocial: string;
      socAux?: CreateSocioSocAuxDto;
    };
