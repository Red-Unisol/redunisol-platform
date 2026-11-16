import { businessDate } from "../../../monthly-cutoffs/domain";
import type { CreateSocioDto } from "../dtos/CreateSocio.dto";
import { parseCivilDate } from "../services/SocioCivilDate";
import {
  normalizeCuit,
  normalizeDocumento,
} from "../services/SocioInputNormalizer";
import {
  InvalidSocioRequestError,
  SocioCuitDuplicateError,
  SocioDocumentoDuplicateError,
} from "../../domain/socios-errors";
import type { SocioRepository } from "../../domain/repositories/SocioRepository";
import type { CrearSocioMutualGateway } from "../../infrastructure/services/CrearSocioMutualGateway";

export type SolicitudParaAltaSocio = {
  createdAt: Date;
  titular: { cuit: string | null; nroDocumento: string | null } | null;
};

type Dependencies = {
  findSolicitudParaAlta: (id: string) => Promise<SolicitudParaAltaSocio | null>;
  now?: () => Date;
  crearSocioMutualGateway: CrearSocioMutualGateway;
  repository: SocioRepository;
};

export class CreateSocioUseCase {
  private readonly findSolicitudParaAlta: Dependencies["findSolicitudParaAlta"];
  private readonly now: () => Date;
  private readonly crearSocioMutualGateway: CrearSocioMutualGateway;
  private readonly repository: SocioRepository;

  constructor(dependencies: Dependencies) {
    this.findSolicitudParaAlta = dependencies.findSolicitudParaAlta;
    this.now = dependencies.now ?? (() => new Date());
    this.crearSocioMutualGateway = dependencies.crearSocioMutualGateway;
    this.repository = dependencies.repository;
  }

  async execute(input: CreateSocioDto) {
    const cuit = normalizeCuit(input.cuit);

    const existingSocio = await this.repository.findByCuit(cuit);

    if (existingSocio) {
      throw new SocioCuitDuplicateError();
    }

    const fechaAlta = await this.resolveFechaAlta(input, cuit);

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
        fechaAlta,
        apellido: input.apellido,
        celular: input.celular ?? null,
        ...(input.cbu ? { cbu: input.cbu } : {}),
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
      fechaAlta,
      celular: input.celular ?? null,
      ...(input.cbu ? { cbu: input.cbu } : {}),
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

  private async resolveFechaAlta(input: CreateSocioDto, cuit: string) {
    // El alta directa no tiene solicitud: usa el dia civil de Argentina.
    if (!input.solicitudId) return businessDate(this.now());

    const solicitud = await this.findSolicitudParaAlta(input.solicitudId);
    if (!solicitud) {
      throw new InvalidSocioRequestError("No se encontro la solicitud para dar de alta al socio.");
    }
    const titular = solicitud.titular;
    const sameCuit = titular?.cuit && normalizeCuit(titular.cuit) === cuit;
    const sameDocumento = !titular?.cuit && input.tipoPersona === "FISICA"
      && titular?.nroDocumento
      && normalizeDocumento(titular.nroDocumento) === normalizeDocumento(input.nroDocumento);
    if (!sameCuit && !sameDocumento) {
      throw new InvalidSocioRequestError("El socio no coincide con el titular de la solicitud.");
    }
    // Como el legacy: la fecha de la solicitud, aunque el alta se grabe despues.
    return businessDate(solicitud.createdAt);
  }
}
