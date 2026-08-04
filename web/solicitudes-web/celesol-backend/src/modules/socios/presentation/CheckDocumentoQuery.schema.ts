import { z } from "zod";

export const checkDocumentoQuerySchema = z
  .object({
    excludeSocioId: z.string().trim().min(1).optional(),
    nroDocumento: z.string().trim().min(1),
  })
  .strict();

export type CheckDocumentoQuery = z.infer<typeof checkDocumentoQuerySchema>;
