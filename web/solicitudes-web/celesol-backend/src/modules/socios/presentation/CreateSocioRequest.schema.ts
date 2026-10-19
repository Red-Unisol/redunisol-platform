import { z } from "zod";

const trimmedRequiredString = z.string().trim().min(1);
// ID de ClasesBase.Localidad en Vimarx (se elige del desplegable).
const localidadIdString = z.string().trim().regex(/^\d+$/);
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

// Enteros de SocAux (Int32 en Vimarx). El formulario los manda como texto.
const normalizedOptionalInteger = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? Number(trimmed) : undefined;
}, z.number().int().min(0).max(2147483647).optional());

// Datos del convenio que Vimarx guarda en SocAux del socio. Todos opcionales.
const socAuxSchema = z
  .object({
    beneficio: normalizedOptionalString.pipe(z.string().max(50).optional()),
    caja40: normalizedOptionalInteger,
    convAux: normalizedOptionalInteger,
  })
  .strict()
  .optional();

// Observaciones de la ficha del socio en Vimarx (no las de la solicitud).
const observacionesSchema = normalizedOptionalString.pipe(
  z.string().max(500).optional(),
);

const personaFisicaSchema = z
  .object({
    apellido: trimmedRequiredString,
    celular: normalizedOptionalString,
    cuit: trimmedRequiredString,
    domicilioCalle: trimmedRequiredString,
    domicilioCodigoPostal: normalizedOptionalString,
    domicilioLocalidad: localidadIdString,
    domicilioNroPuerta: normalizedOptionalString,
    email: normalizedOptionalEmail,
    fechaDeNacimiento: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    nombre: trimmedRequiredString,
    nroDocumento: trimmedRequiredString,
    observaciones: observacionesSchema,
    sexo: trimmedRequiredString,
    socAux: socAuxSchema,
    tipoDocumento: trimmedRequiredString,
    tipoPersona: z.literal("FISICA"),
  })
  .strict();

const personaJuridicaSchema = z
  .object({
    celular: normalizedOptionalString,
    cuit: trimmedRequiredString,
    domicilioCalle: trimmedRequiredString,
    domicilioCodigoPostal: normalizedOptionalString,
    domicilioLocalidad: localidadIdString,
    domicilioNroPuerta: normalizedOptionalString,
    email: normalizedOptionalEmail,
    observaciones: observacionesSchema,
    razonSocial: trimmedRequiredString,
    socAux: socAuxSchema,
    tipoPersona: z.literal("JURIDICA"),
  })
  .strict();

export const createSocioBodySchema = z.discriminatedUnion("tipoPersona", [
  personaFisicaSchema,
  personaJuridicaSchema,
]);

export type CreateSocioBody = z.infer<typeof createSocioBodySchema>;
