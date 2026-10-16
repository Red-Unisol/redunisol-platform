import { z } from "zod";

// search: texto a buscar; ids: ids separados por coma, para mostrar la
// localidad ya cargada de un socio.
export const listLocalidadesQuerySchema = z
  .object({
    ids: z
      .string()
      .trim()
      .regex(/^\d+(,\d+)*$/)
      .transform((value) => value.split(","))
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    search: z.string().trim().max(100).optional(),
  })
  .strict();

export type ListLocalidadesQuery = z.infer<typeof listLocalidadesQuerySchema>;
