import { InvalidSocioRequestError } from "../../domain/socios-errors";
import type { UpdateSocioDto } from "../dtos/UpdateSocio.dto";

export function validateSocioFisicaPatch(input: UpdateSocioDto): void {
  if (input.razonSocial !== undefined) {
    throw new InvalidSocioRequestError(
      "Razon social no es valida para una persona fisica.",
    );
  }
}
