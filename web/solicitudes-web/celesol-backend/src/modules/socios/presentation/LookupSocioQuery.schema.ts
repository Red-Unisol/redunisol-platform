import { z } from "zod";

export const lookupSocioQuerySchema = z
  .object({
    documento: z.string().trim().min(1),
    tipoDocumento: z.string().trim().min(1).optional(),
  })
  .strict();

export type LookupSocioQuery = z.infer<typeof lookupSocioQuerySchema>;

