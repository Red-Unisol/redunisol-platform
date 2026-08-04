import { z } from "zod";

const requiredTrimmedStringSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim();
}, z.string().min(1));

const optionalTrimmedStringSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().min(1).optional());

const montoSchema = z.coerce.number().positive("monto debe ser mayor a 0");

export const solicitudCancelacionSolicitudParamsSchema = z.object({
  id: z.string().uuid("id must be a valid uuid"),
});

export const solicitudCancelacionByIdParamsSchema = z.object({
  cancelacionId: z.string().uuid("cancelacionId must be a valid uuid"),
  id: z.string().uuid("id must be a valid uuid"),
});

export const createSolicitudCancelacionBodySchema = z.object({
  cbu: requiredTrimmedStringSchema,
  cuentaADebitar: requiredTrimmedStringSchema,
  cuentaBancaria: requiredTrimmedStringSchema,
  monto: montoSchema,
  notas: optionalTrimmedStringSchema,
  socio: requiredTrimmedStringSchema,
  socioLegacyId: optionalTrimmedStringSchema,
});

export const updateSolicitudCancelacionBodySchema = z.object({
  cbu: optionalTrimmedStringSchema,
  cuentaADebitar: optionalTrimmedStringSchema,
  cuentaBancaria: optionalTrimmedStringSchema,
  monto: montoSchema.optional(),
  notas: optionalTrimmedStringSchema,
  socio: optionalTrimmedStringSchema,
  socioLegacyId: optionalTrimmedStringSchema,
});

export type SolicitudCancelacionSolicitudParams = z.infer<
  typeof solicitudCancelacionSolicitudParamsSchema
>;
export type SolicitudCancelacionByIdParams = z.infer<
  typeof solicitudCancelacionByIdParamsSchema
>;
export type CreateSolicitudCancelacionBody = z.infer<
  typeof createSolicitudCancelacionBodySchema
>;
export type UpdateSolicitudCancelacionBody = z.infer<
  typeof updateSolicitudCancelacionBodySchema
>;
