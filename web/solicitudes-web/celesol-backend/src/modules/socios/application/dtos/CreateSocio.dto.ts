export type CreateSocioDto =
  | {
      tipoPersona: "FISICA";
      apellido: string;
      celular?: string;
      cuit: string;
      domicilioCalle: string;
      domicilioCodigoPostal: string;
      domicilioLocalidad: string;
      domicilioNroPuerta: string;
      email?: string;
      fechaDeNacimiento: string;
      nombre: string;
      nroDocumento: string;
      sexo: string;
      tipoDocumento: string;
    }
  | {
      tipoPersona: "JURIDICA";
      celular?: string;
      cuit: string;
      domicilioCalle: string;
      domicilioCodigoPostal: string;
      domicilioLocalidad: string;
      domicilioNroPuerta: string;
      email?: string;
      razonSocial: string;
    };
