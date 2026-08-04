import type { Socio } from "../../domain/entities/Socio.entity";

type SocioPrismaRecord = {
  apellido: string | null;
  celular: string | null;
  createdAt: Date;
  cuit: string;
  domicilioCalle: string | null;
  domicilioCodigoPostal: string | null;
  domicilioLocalidad: string | null;
  domicilioNroPuerta: string | null;
  email: string | null;
  fechaDeNacimiento: Date | null;
  id: string;
  nombre: string | null;
  nroDocumento: string | null;
  nroSocioLegacy: string | null;
  razonSocial: string | null;
  sexo: string | null;
  tipoDocumento: string | null;
  tipoPersona: "FISICA" | "JURIDICA";
  updatedAt: Date;
};

export class SocioMapper {
  static toDomain(record: SocioPrismaRecord): Socio {
    if (record.tipoPersona === "FISICA") {
      return {
        apellido: record.apellido ?? "",
        celular: record.celular,
        createdAt: record.createdAt,
        cuit: record.cuit,
        domicilioCalle: record.domicilioCalle,
        domicilioCodigoPostal: record.domicilioCodigoPostal,
        domicilioLocalidad: record.domicilioLocalidad,
        domicilioNroPuerta: record.domicilioNroPuerta,
        email: record.email,
        fechaDeNacimiento: record.fechaDeNacimiento ?? new Date(0),
        id: record.id,
        nombre: record.nombre ?? "",
        nroDocumento: record.nroDocumento ?? "",
        nroSocioLegacy: record.nroSocioLegacy,
        razonSocial: null,
        sexo: record.sexo ?? "",
        tipoDocumento: record.tipoDocumento ?? "",
        tipoPersona: "FISICA",
        updatedAt: record.updatedAt,
      };
    }

    return {
      apellido: null,
      celular: record.celular,
      createdAt: record.createdAt,
      cuit: record.cuit,
      domicilioCalle: record.domicilioCalle,
      domicilioCodigoPostal: record.domicilioCodigoPostal,
      domicilioLocalidad: record.domicilioLocalidad,
      domicilioNroPuerta: record.domicilioNroPuerta,
      email: record.email,
      fechaDeNacimiento: null,
      id: record.id,
      nombre: null,
      nroDocumento: null,
      nroSocioLegacy: record.nroSocioLegacy,
      razonSocial: record.razonSocial ?? "",
      sexo: null,
      tipoDocumento: null,
      tipoPersona: "JURIDICA",
      updatedAt: record.updatedAt,
    };
  }
}
