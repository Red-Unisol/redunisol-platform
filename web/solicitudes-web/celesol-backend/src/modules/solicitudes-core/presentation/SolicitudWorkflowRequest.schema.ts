import { z } from "zod";
import { patchSolicitudBodySchema } from "./SolicitudesCoreRequest.schema";

export const changeSolicitudStateBodySchema = z.object({
  actionCode: z.string().trim().min(1),
  comment: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(1).optional(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  changes: patchSolicitudBodySchema.optional(),
}).strict().refine(
  body => body.actionCode === "finalizar_revision_datos"
    ? Boolean(body.expectedUpdatedAt)
    : body.expectedUpdatedAt === undefined && body.changes === undefined,
  { message: "La revisión de datos requiere la versión de la ficha. Sólo esa acción admite cambios." },
);

export type ChangeSolicitudStateBody = z.infer<
  typeof changeSolicitudStateBodySchema
>;
