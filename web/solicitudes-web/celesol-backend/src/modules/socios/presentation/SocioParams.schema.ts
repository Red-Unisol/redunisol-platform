import { z } from "zod";

export const socioIdParamsSchema = z.object({
  id: z.string().uuid("id must be a valid uuid"),
});

export type SocioIdParams = z.infer<typeof socioIdParamsSchema>;
