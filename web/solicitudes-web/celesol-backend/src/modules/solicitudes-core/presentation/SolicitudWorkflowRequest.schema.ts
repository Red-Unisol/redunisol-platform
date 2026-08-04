import { z } from "zod";

export const changeSolicitudStateBodySchema = z.object({
  actionCode: z.string().trim().min(1),
  comment: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(1).optional(),
}).strict();

export type ChangeSolicitudStateBody = z.infer<
  typeof changeSolicitudStateBodySchema
>;
