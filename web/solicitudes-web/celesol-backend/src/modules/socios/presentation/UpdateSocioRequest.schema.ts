import { z } from "zod";
import { socioIdParamsSchema } from "./SocioParams.schema";

export { socioIdParamsSchema } from "./SocioParams.schema";

const normalizedOptionalString = z.preprocess((value) => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().trim().min(1).optional());

const normalizedOptionalEmail = z.preprocess((value) => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : undefined;
}, z.string().email().optional());

export const updateSocioBodySchema = z
  .object({
    apellido: normalizedOptionalString,
    celular: normalizedOptionalString,
    cuit: normalizedOptionalString,
    domicilioCalle: normalizedOptionalString,
    domicilioCodigoPostal: normalizedOptionalString,
    domicilioLocalidad: normalizedOptionalString,
    domicilioNroPuerta: normalizedOptionalString,
    email: normalizedOptionalEmail,
    fechaDeNacimiento: z
      .preprocess((value) => {
        if (value === undefined) {
          return undefined;
        }

        if (typeof value !== "string") {
          return value;
        }

        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      }, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
    nombre: normalizedOptionalString,
    nroDocumento: normalizedOptionalString,
    razonSocial: normalizedOptionalString,
    sexo: normalizedOptionalString,
    tipoDocumento: normalizedOptionalString,
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Patch body cannot be empty.",
  });

export type SocioIdParams = z.infer<typeof socioIdParamsSchema>;
export type UpdateSocioBody = z.infer<typeof updateSocioBodySchema>;
