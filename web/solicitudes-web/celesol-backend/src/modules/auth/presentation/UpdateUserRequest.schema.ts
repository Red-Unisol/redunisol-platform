import { z } from "zod";

const uuidLikeSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
);

export const updateUserParamsSchema = z.object({
  id: uuidLikeSchema,
});

export const updateUserBodySchema = z
  .object({
    email: z.string().email().optional(),
    firstName: z.string().trim().min(1).optional(),
    isSystemAdmin: z.boolean().optional(),
    lastName: z.string().trim().min(1).optional(),
    legacyUser: z.string().trim().min(1).optional(),
    state: z.union([z.literal(0), z.literal(1)]).optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.email !== undefined ||
      body.firstName !== undefined ||
      body.isSystemAdmin !== undefined ||
      body.lastName !== undefined ||
      body.legacyUser !== undefined ||
      body.state !== undefined,
    {
      message: "At least one field is required.",
    },
  );

export type UpdateUserParams = z.infer<typeof updateUserParamsSchema>;
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;
