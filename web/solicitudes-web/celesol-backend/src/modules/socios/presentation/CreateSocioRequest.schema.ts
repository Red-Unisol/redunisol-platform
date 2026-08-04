import { z } from "zod";

const trimmedRequiredString = z.string().trim().min(1);
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

const personaFisicaSchema = z
  .object({
    apellido: trimmedRequiredString,
    celular: normalizedOptionalString,
    cuit: trimmedRequiredString,
    domicilioCalle: trimmedRequiredString,
    domicilioCodigoPostal: trimmedRequiredString,
    domicilioLocalidad: trimmedRequiredString,
    domicilioNroPuerta: trimmedRequiredString,
    email: normalizedOptionalEmail,
    fechaDeNacimiento: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    nombre: trimmedRequiredString,
    nroDocumento: trimmedRequiredString,
    sexo: trimmedRequiredString,
    tipoDocumento: trimmedRequiredString,
    tipoPersona: z.literal("FISICA"),
  })
  .strict();

const personaJuridicaSchema = z
  .object({
    celular: normalizedOptionalString,
    cuit: trimmedRequiredString,
    domicilioCalle: trimmedRequiredString,
    domicilioCodigoPostal: trimmedRequiredString,
    domicilioLocalidad: trimmedRequiredString,
    domicilioNroPuerta: trimmedRequiredString,
    email: normalizedOptionalEmail,
    razonSocial: trimmedRequiredString,
    tipoPersona: z.literal("JURIDICA"),
  })
  .strict();

export const createSocioBodySchema = z.discriminatedUnion("tipoPersona", [
  personaFisicaSchema,
  personaJuridicaSchema,
]);

export type CreateSocioBody = z.infer<typeof createSocioBodySchema>;
