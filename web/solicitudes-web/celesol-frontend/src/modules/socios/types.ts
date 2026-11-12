export type SocioTipoPersona = "FISICA" | "JURIDICA";

type SocioBase = {
  celular: string | null;
  createdAt: string;
  cuit: string;
  domicilioCalle: string | null;
  domicilioCodigoPostal: string | null;
  domicilioLocalidad: string | null;
  domicilioNroPuerta: string | null;
  email: string | null;
  id: string;
  nroSocioLegacy: string | null;
  updatedAt: string;
};

export type SocioFisico = SocioBase & {
  apellido: string;
  fechaDeNacimiento: string;
  nombre: string;
  nroDocumento: string;
  razonSocial: null;
  sexo: string;
  tipoDocumento: string;
  tipoPersona: "FISICA";
};

export type SocioJuridico = SocioBase & {
  apellido: null;
  fechaDeNacimiento: null;
  nombre: null;
  nroDocumento: null;
  razonSocial: string;
  sexo: null;
  tipoDocumento: null;
  tipoPersona: "JURIDICA";
};

export type Socio = SocioFisico | SocioJuridico;

export type CheckCuitResponse = {
  exists: boolean;
};

export type CheckDocumentoResponse = {
  exists: boolean;
};

export type LookupSocioResponse =
  | {
      match: "none";
    }
  | {
      match: "multiple";
    }
  | {
      match: "single";
      socio: Socio;
    };

// Localidad de Vimarx (ClasesBase.Localidad). El socio guarda el id.
export type Localidad = {
  codigoPostal: string | null;
  id: string;
  nombre: string;
  provincia: string | null;
};

// Datos del convenio que Vimarx guarda en SocAux del socio.
export type CreateSocioSocAux = {
  beneficio?: string;
  caja40?: number;
  convAux?: number;
};

// Categoria con la que el socio se da de alta en Vimarx. Regla de la mutual:
// ADHERENTE CONVENIO, salvo AMEJUCA y Mudon, que tienen la suya.
export type SocioCategoria = "ADHERENTE_CONVENIO" | "AMEJUCA" | "MUDON";

export const SOCIO_CATEGORIA_OPTIONS: { label: string; value: SocioCategoria }[] =
  [
    { label: "Adherente convenio", value: "ADHERENTE_CONVENIO" },
    { label: "AMEJUCA", value: "AMEJUCA" },
    { label: "Mudon", value: "MUDON" },
  ];

// Desde una solicitud, la categoria sale de la linea: las que se llaman
// AMEJUCA o Mudon (de haberes o de CBU) van a la suya; el resto, y una
// solicitud sin linea, a ADHERENTE CONVENIO.
export function socioCategoriaPorLinea(
  lineaDescripcion: string | null | undefined,
): SocioCategoria {
  const descripcion = (lineaDescripcion ?? "").toUpperCase();

  if (descripcion.includes("AMEJUCA")) {
    return "AMEJUCA";
  }

  if (descripcion.includes("MUDON")) {
    return "MUDON";
  }

  return "ADHERENTE_CONVENIO";
}

export type CreateSocioRequest =
  | {
      apellido: string;
      categoria?: SocioCategoria;
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
      razonSocial?: never;
      sexo: string;
      socAux?: CreateSocioSocAux;
      tipoDocumento: string;
      tipoPersona: "FISICA";
    }
  | {
      apellido?: never;
      categoria?: SocioCategoria;
      celular?: string;
      cuit: string;
      domicilioCalle: string;
      domicilioCodigoPostal?: string;
      domicilioLocalidad: string;
      domicilioNroPuerta?: string;
      email?: string;
      fechaDeNacimiento?: never;
      nombre?: never;
      nroDocumento?: never;
      observaciones?: string;
      razonSocial: string;
      sexo?: never;
      socAux?: CreateSocioSocAux;
      tipoDocumento?: never;
      tipoPersona: "JURIDICA";
    };

export type UpdateSocioRequest = {
  apellido?: string;
  celular?: string;
  cuit?: string;
  domicilioCalle?: string;
  domicilioCodigoPostal?: string;
  domicilioLocalidad?: string;
  domicilioNroPuerta?: string;
  email?: string;
  fechaDeNacimiento?: string;
  nombre?: string;
  nroDocumento?: string;
  razonSocial?: string;
  sexo?: string;
  tipoDocumento?: string;
};
