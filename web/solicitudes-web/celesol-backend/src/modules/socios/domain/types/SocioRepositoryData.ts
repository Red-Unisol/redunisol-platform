export type CreateSocioData =
  | {
      tipoPersona: "FISICA";
      apellido: string;
      celular?: string | null;
      cuit: string;
      domicilioCalle: string;
      domicilioCodigoPostal: string;
      domicilioLocalidad: string;
      domicilioNroPuerta: string;
      email?: string | null;
      fechaDeNacimiento: Date;
      nombre: string;
      nroDocumento: string;
      nroSocioLegacy: string | null;
      razonSocial: null;
      sexo: string;
      tipoDocumento: string;
    }
  | {
      tipoPersona: "JURIDICA";
      apellido: null;
      celular?: string | null;
      cuit: string;
      domicilioCalle: string;
      domicilioCodigoPostal: string;
      domicilioLocalidad: string;
      domicilioNroPuerta: string;
      email?: string | null;
      fechaDeNacimiento: null;
      nombre: null;
      nroDocumento: null;
      nroSocioLegacy: string | null;
      razonSocial: string;
      sexo: null;
      tipoDocumento: null;
    };

export type UpdateSocioFisicaData = {
  tipoPersona: "FISICA";
  apellido?: string;
  celular?: string | null;
  cuit?: string;
  domicilioCalle?: string;
  domicilioCodigoPostal?: string;
  domicilioLocalidad?: string;
  domicilioNroPuerta?: string;
  email?: string | null;
  fechaDeNacimiento?: Date;
  nombre?: string;
  nroDocumento?: string;
  sexo?: string;
  tipoDocumento?: string;
};

export type UpdateSocioJuridicaData = {
  tipoPersona: "JURIDICA";
  celular?: string | null;
  cuit?: string;
  domicilioCalle?: string;
  domicilioCodigoPostal?: string;
  domicilioLocalidad?: string;
  domicilioNroPuerta?: string;
  email?: string | null;
  razonSocial?: string;
};

export type UpdateSocioData = UpdateSocioFisicaData | UpdateSocioJuridicaData;
