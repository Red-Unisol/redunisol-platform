import { z } from "zod";

export const updateOwnProfileRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("email must be valid").optional(),
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.email !== undefined ||
      body.firstName !== undefined ||
      body.lastName !== undefined,
    {
      message: "At least one field is required.",
    },
  );

export type UpdateOwnProfileRequestBody = z.infer<
  typeof updateOwnProfileRequestSchema
>;
