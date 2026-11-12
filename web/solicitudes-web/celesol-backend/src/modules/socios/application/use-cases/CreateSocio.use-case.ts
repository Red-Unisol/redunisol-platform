import type { CreateSocioDto } from "../dtos/CreateSocio.dto";
import { parseCivilDate } from "../services/SocioCivilDate";
import {
  normalizeCuit,
  normalizeDocumento,
} from "../services/SocioInputNormalizer";
import {
  SocioCuitDuplicateError,
  SocioDocumentoDuplicateError,
} from "../../domain/socios-errors";
import { SOCIO_CATEGORIA_POR_DEFECTO } from "../../domain/SocioCategoria";
import type { SocioRepository } from "../../domain/repositories/SocioRepository";
import type { CrearSocioMutualGateway } from "../../infrastructure/services/CrearSocioMutualGateway";

type Dependencies = {
  crearSocioMutualGateway: CrearSocioMutualGateway;
  repository: SocioRepository;
};

export class CreateSocioUseCase {
  private readonly crearSocioMutualGateway: CrearSocioMutualGateway;
  private readonly repository: SocioRepository;

  constructor(dependencies: Dependencies) {
    this.crearSocioMutualGateway = dependencies.crearSocioMutualGateway;
    this.repository = dependencies.repository;
  }

  async execute(input: CreateSocioDto) {
    const cuit = normalizeCuit(input.cuit);

    const existingSocio = await this.repository.findByCuit(cuit);

    if (existingSocio) {
      throw new SocioCuitDuplicateError();
    }

    const categoria = input.categoria ?? SOCIO_CATEGORIA_POR_DEFECTO;
    const domicilio = {
      calle: input.domicilioCalle,
      codigoPostal: input.domicilioCodigoPostal ?? null,
      localidad: input.domicilioLocalidad,
      nroPuerta: input.domicilioNroPuerta ?? null,
    };

    if (input.tipoPersona === "FISICA") {
      const nroDocumento = normalizeDocumento(input.nroDocumento);
      const existingDocumento = await this.repository.findByDocumento(
        nroDocumento,
      );

      if (existingDocumento) {
        throw new SocioDocumentoDuplicateError();
      }

      const legacyResult = await this.crearSocioMutualGateway.crear({
        tipoPersona: "FISICA",
        apellido: input.apellido,
        categoria,
        celular: input.celular ?? null,
        cuit,
        domicilio,
        email: input.email ?? null,
        fechaDeNacimiento: input.fechaDeNacimiento,
        nombre: input.nombre,
        nroDocumento,
        observaciones: input.observaciones ?? null,
        sexo: input.sexo,
        socAux: input.socAux ?? null,
      });

      return this.repository.create({
        apellido: input.apellido,
        celular: input.celular ?? null,
        cuit,
        domicilioCalle: input.domicilioCalle,
        domicilioCodigoPostal: input.domicilioCodigoPostal ?? null,
        domicilioLocalidad: input.domicilioLocalidad,
        domicilioNroPuerta: input.domicilioNroPuerta ?? null,
        email: input.email ?? null,
        fechaDeNacimiento: parseCivilDate(input.fechaDeNacimiento),
        nombre: input.nombre,
        nroDocumento,
        nroSocioLegacy: legacyResult.id,
        razonSocial: null,
        sexo: input.sexo,
        tipoDocumento: input.tipoDocumento,
        tipoPersona: "FISICA",
      });
    }

    const legacyResult = await this.crearSocioMutualGateway.crear({
      tipoPersona: "JURIDICA",
      categoria,
      celular: input.celular ?? null,
      cuit,
      domicilio,
      email: input.email ?? null,
      observaciones: input.observaciones ?? null,
      razonSocial: input.razonSocial,
      socAux: input.socAux ?? null,
    });

    return this.repository.create({
      apellido: null,
      celular: input.celular ?? null,
      cuit,
      domicilioCalle: input.domicilioCalle,
      domicilioCodigoPostal: input.domicilioCodigoPostal ?? null,
      domicilioLocalidad: input.domicilioLocalidad,
      domicilioNroPuerta: input.domicilioNroPuerta ?? null,
      email: input.email ?? null,
      fechaDeNacimiento: null,
      nombre: null,
      nroDocumento: null,
      nroSocioLegacy: legacyResult.id,
      razonSocial: input.razonSocial,
      sexo: null,
      tipoDocumento: null,
      tipoPersona: "JURIDICA",
    });
  }
}
