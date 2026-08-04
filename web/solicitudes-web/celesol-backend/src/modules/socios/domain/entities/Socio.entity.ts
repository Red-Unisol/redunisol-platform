export type SocioBase = {
  celular: string | null;
  createdAt: Date;
  cuit: string;
  email: string | null;
  id: string;
  nroSocioLegacy: string | null;
  updatedAt: Date;
};

export type SocioFisica = SocioBase & {
  apellido: string;
  domicilioCalle: string | null;
  domicilioCodigoPostal: string | null;
  domicilioLocalidad: string | null;
  domicilioNroPuerta: string | null;
  fechaDeNacimiento: Date;
  nombre: string;
  nroDocumento: string;
  razonSocial: null;
  sexo: string;
  tipoDocumento: string;
  tipoPersona: "FISICA";
};

export type SocioJuridica = SocioBase & {
  apellido: null;
  domicilioCalle: string | null;
  domicilioCodigoPostal: string | null;
  domicilioLocalidad: string | null;
  domicilioNroPuerta: string | null;
  fechaDeNacimiento: null;
  nombre: null;
  nroDocumento: null;
  razonSocial: string;
  sexo: null;
  tipoDocumento: null;
  tipoPersona: "JURIDICA";
};

export type Socio = SocioFisica | SocioJuridica;
