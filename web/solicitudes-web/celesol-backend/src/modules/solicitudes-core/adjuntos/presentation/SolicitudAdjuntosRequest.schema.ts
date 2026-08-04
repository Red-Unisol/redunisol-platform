import { z } from "zod";

import { TIPO_ADJUNTO_VALUES, MAX_ADJUNTOS_LOTE } from "../domain/TiposAdjuntoCatalog";

const optionalTrimmedStringSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().min(1).optional(),
);

const optionalBooleanSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return value;
}, z.boolean().optional());

export const solicitudAdjuntoSolicitudParamsSchema = z.object({
  id: z.string().uuid("id must be a valid uuid"),
});

export const solicitudAdjuntoByIdParamsSchema = z.object({
  adjuntoId: z.string().uuid("adjuntoId must be a valid uuid"),
  id: z.string().uuid("id must be a valid uuid"),
});

export const uploadSolicitudAdjuntoBodySchema = z.object({
  adicional: optionalTrimmedStringSchema,
  comentario: optionalTrimmedStringSchema,
  descripcion: optionalTrimmedStringSchema,
  nroDocumento: optionalTrimmedStringSchema,
  restringido: optionalBooleanSchema,
  tipoAdjunto: optionalTrimmedStringSchema,
});

const uploadSolicitudAdjuntoLoteItemSchema = z.object({
  adicional: optionalTrimmedStringSchema,
  comentario: optionalTrimmedStringSchema,
  descripcion: optionalTrimmedStringSchema,
  nroDocumento: optionalTrimmedStringSchema,
  restringido: optionalBooleanSchema,
  tipoAdjunto: z.enum(TIPO_ADJUNTO_VALUES, {
    message: "tipoAdjunto es requerido y debe pertenecer al catálogo.",
  }),
});

export const uploadSolicitudAdjuntosBatchBodySchema = z.object({
  metadata: z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }, z.array(uploadSolicitudAdjuntoLoteItemSchema).min(1).max(MAX_ADJUNTOS_LOTE)),
});

export type UploadSolicitudAdjuntosBatchBody = z.infer<
  typeof uploadSolicitudAdjuntosBatchBodySchema
>;

export const deleteSolicitudAdjuntoBodySchema = z.object({
  comentario: optionalTrimmedStringSchema,
  deleteReason: optionalTrimmedStringSchema,
});

export type DeleteSolicitudAdjuntoBody = z.infer<
  typeof deleteSolicitudAdjuntoBodySchema
>;
export type SolicitudAdjuntoByIdParams = z.infer<
  typeof solicitudAdjuntoByIdParamsSchema
>;
export type SolicitudAdjuntoSolicitudParams = z.infer<
  typeof solicitudAdjuntoSolicitudParamsSchema
>;
export const patchSolicitudAdjuntoBodySchema = uploadSolicitudAdjuntoBodySchema;

export type PatchSolicitudAdjuntoBody = z.infer<
  typeof patchSolicitudAdjuntoBodySchema
>;
export type UploadSolicitudAdjuntoBody = z.infer<
  typeof uploadSolicitudAdjuntoBodySchema
>;
