export type PersonaFisicaResponse = {
  id: string;
  tipoPersona: "FISICA";
  cuit: string;
  email: string | null;
  celular: string | null;
  nroSocioLegacy: string | null;
  apellido: string;
  nombre: string;
  nroDocumento: string;
  tipoDocumento: string;
  sexo: string;
  fechaDeNacimiento: string;
  domicilioCalle: string | null;
  domicilioNroPuerta: string | null;
  domicilioLocalidad: string | null;
  domicilioCodigoPostal: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PersonaJuridicaResponse = {
  id: string;
  tipoPersona: "JURIDICA";
  cuit: string;
  email: string | null;
  celular: string | null;
  nroSocioLegacy: string | null;
  razonSocial: string;
  domicilioCalle: string | null;
  domicilioNroPuerta: string | null;
  domicilioLocalidad: string | null;
  domicilioCodigoPostal: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SocioResponse = PersonaFisicaResponse | PersonaJuridicaResponse;
