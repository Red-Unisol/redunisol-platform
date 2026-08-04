import { z } from "zod";

import {
  SOLICITUDES_HISTORICAS_DEFAULT_MAX,
  SOLICITUDES_MAX_LIMIT,
  SOLICITUDES_PRECARGA_DEFAULT_MAX,
  SOLICITUDES_RECIENTES_DEFAULT_MAX,
} from "../infrastructure/services/EvaluateListSolicitudesGateway";

const maxSchema = (defaultValue: number) =>
  z.object({
    max: z.coerce
      .number()
      .int("max must be an integer")
      .min(1, "max must be greater than 0")
      .max(SOLICITUDES_MAX_LIMIT, "max exceeds allowed limit")
      .default(defaultValue),
  });

export const solicitudesPrecargaQuerySchema = maxSchema(
  SOLICITUDES_PRECARGA_DEFAULT_MAX,
);
export const solicitudesRecientesQuerySchema = maxSchema(
  SOLICITUDES_RECIENTES_DEFAULT_MAX,
);
export const solicitudesHistoricasQuerySchema = maxSchema(
  SOLICITUDES_HISTORICAS_DEFAULT_MAX,
);

export const solicitudDetalleQuerySchema = z.object({
  nroSolicitud: z.string().trim().min(1, "nroSolicitud is required"),
});

export const socioMutualQuerySchema = z.object({
  dni: z.string().trim().regex(/^\d+$/, "dni must contain only digits"),
});

export const solicitudDetailByOidQuerySchema = z.object({
  oid: z.string().trim().regex(/^\d+$/, "oid must contain only digits"),
});

export const socioMutualCancelacionDetalleQuerySchema = z.object({
  id: z.string().trim().regex(/^\d+$/, "id must contain only digits"),
});

export type MaxQuery = z.infer<typeof solicitudesPrecargaQuerySchema>;
export type SolicitudDetalleQuery = z.infer<typeof solicitudDetalleQuerySchema>;
export type SolicitudDetailByOidQuery = z.infer<
  typeof solicitudDetailByOidQuerySchema
>;
export type SocioMutualQuery = z.infer<typeof socioMutualQuerySchema>;
export type SocioMutualCancelacionDetalleQuery = z.infer<
  typeof socioMutualCancelacionDetalleQuerySchema
>;
