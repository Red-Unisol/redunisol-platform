import type { UpdateSocioDto } from "../dtos/UpdateSocio.dto";
import { parseCivilDate } from "../services/SocioCivilDate";
import {
  normalizeCuit,
  normalizeDocumento,
} from "../services/SocioInputNormalizer";
import { validateSocioFisicaPatch } from "../services/ValidateSocioFisicaPatch";
import { validateSocioJuridicaPatch } from "../services/ValidateSocioJuridicaPatch";
import {
  SocioCuitDuplicateError,
  SocioDocumentoDuplicateError,
  SocioNotFoundError,
} from "../../domain/socios-errors";
import type {
  UpdateSocioData,
  UpdateSocioFisicaData,
  UpdateSocioJuridicaData,
} from "../../domain/types/SocioRepositoryData";
import type { SocioRepository } from "../../domain/repositories/SocioRepository";

type UpdateSocioInput = {
  body: UpdateSocioDto;
  id: string;
};

type Dependencies = {
  repository: SocioRepository;
};

export class UpdateSocioUseCase {
  private readonly repository: SocioRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  async execute(input: UpdateSocioInput) {
    const socio = await this.repository.findById(input.id);

    if (!socio) {
      throw new SocioNotFoundError();
    }

    if (socio.tipoPersona === "FISICA") {
      validateSocioFisicaPatch(input.body);
      const patch: UpdateSocioFisicaData = { tipoPersona: "FISICA" };

      if (input.body.cuit !== undefined) {
        const cuit = normalizeCuit(input.body.cuit);
        const existingSocio = await this.repository.findByCuit(cuit, socio.id);

        if (existingSocio) {
          throw new SocioCuitDuplicateError();
        }

        patch.cuit = cuit;
      }

      if (input.body.nroDocumento !== undefined) {
        const nroDocumento = normalizeDocumento(input.body.nroDocumento);
        const existingSocio = await this.repository.findByDocumento(
          nroDocumento,
          socio.id,
        );

        if (existingSocio) {
          throw new SocioDocumentoDuplicateError();
        }

        patch.nroDocumento = nroDocumento;
      }

      if (input.body.apellido !== undefined) {
        patch.apellido = input.body.apellido;
      }

      if (input.body.celular !== undefined) {
        patch.celular = input.body.celular;
      }

      if (input.body.email !== undefined) {
        patch.email = input.body.email;
      }

      if (input.body.fechaDeNacimiento !== undefined) {
        patch.fechaDeNacimiento = parseCivilDate(input.body.fechaDeNacimiento);
      }

      if (input.body.nombre !== undefined) {
        patch.nombre = input.body.nombre;
      }

      if (input.body.sexo !== undefined) {
        patch.sexo = input.body.sexo;
      }

      if (input.body.tipoDocumento !== undefined) {
        patch.tipoDocumento = input.body.tipoDocumento;
      }

      if (input.body.domicilioCalle !== undefined) {
        patch.domicilioCalle = input.body.domicilioCalle;
      }

      if (input.body.domicilioNroPuerta !== undefined) {
        patch.domicilioNroPuerta = input.body.domicilioNroPuerta;
      }

      if (input.body.domicilioLocalidad !== undefined) {
        patch.domicilioLocalidad = input.body.domicilioLocalidad;
      }

      if (input.body.domicilioCodigoPostal !== undefined) {
        patch.domicilioCodigoPostal = input.body.domicilioCodigoPostal;
      }

      return this.repository.update(input.id, patch);
    }

    validateSocioJuridicaPatch(input.body);
    const patch: UpdateSocioJuridicaData = { tipoPersona: "JURIDICA" };

    if (input.body.cuit !== undefined) {
      const cuit = normalizeCuit(input.body.cuit);
      const existingSocio = await this.repository.findByCuit(cuit, socio.id);

      if (existingSocio) {
        throw new SocioCuitDuplicateError();
      }

      patch.cuit = cuit;
    }

    if (input.body.celular !== undefined) {
      patch.celular = input.body.celular;
    }

    if (input.body.email !== undefined) {
      patch.email = input.body.email;
    }

    if (input.body.razonSocial !== undefined) {
      patch.razonSocial = input.body.razonSocial;
    }

    if (input.body.domicilioCalle !== undefined) {
      patch.domicilioCalle = input.body.domicilioCalle;
    }

    if (input.body.domicilioNroPuerta !== undefined) {
      patch.domicilioNroPuerta = input.body.domicilioNroPuerta;
    }

    if (input.body.domicilioLocalidad !== undefined) {
      patch.domicilioLocalidad = input.body.domicilioLocalidad;
    }

    if (input.body.domicilioCodigoPostal !== undefined) {
      patch.domicilioCodigoPostal = input.body.domicilioCodigoPostal;
    }

    return this.repository.update(input.id, patch as UpdateSocioData);
  }
}
