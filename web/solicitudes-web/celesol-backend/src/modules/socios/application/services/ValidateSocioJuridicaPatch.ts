import { InvalidSocioRequestError } from "../../domain/socios-errors";
import type { UpdateSocioDto } from "../dtos/UpdateSocio.dto";

export function validateSocioJuridicaPatch(input: UpdateSocioDto): void {
  if (input.apellido !== undefined) {
    throw new InvalidSocioRequestError(
      "Apellido no es valido para una persona juridica.",
    );
  }

  if (input.nombre !== undefined) {
    throw new InvalidSocioRequestError(
      "Nombre no es valido para una persona juridica.",
    );
  }

  if (input.nroDocumento !== undefined) {
    throw new InvalidSocioRequestError(
      "Nro documento no es valido para una persona juridica.",
    );
  }

  if (input.tipoDocumento !== undefined) {
    throw new InvalidSocioRequestError(
      "Tipo documento no es valido para una persona juridica.",
    );
  }

  if (input.sexo !== undefined) {
    throw new InvalidSocioRequestError(
      "Sexo no es valido para una persona juridica.",
    );
  }

  if (input.fechaDeNacimiento !== undefined) {
    throw new InvalidSocioRequestError(
      "Fecha de nacimiento no es valida para una persona juridica.",
    );
  }
}
