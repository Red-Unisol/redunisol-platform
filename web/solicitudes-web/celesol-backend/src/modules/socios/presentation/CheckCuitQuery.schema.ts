import { z } from "zod";

export const checkCuitQuerySchema = z
  .object({
    cuit: z.string().trim().min(1),
    excludeSocioId: z.string().trim().min(1).optional(),
  })
  .strict();

export type CheckCuitQuery = z.infer<typeof checkCuitQuerySchema>;
