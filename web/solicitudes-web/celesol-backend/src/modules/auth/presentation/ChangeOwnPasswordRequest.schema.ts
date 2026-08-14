import { z } from "zod";

const strongPasswordSchema = z
  .string()
  .min(8, "password must be at least 8 characters")
  .regex(/[a-z]/, "password must include a lowercase letter")
  .regex(/[A-Z]/, "password must include an uppercase letter")
  .regex(/[0-9]/, "password must include a number")
  .regex(/[^A-Za-z0-9]/, "password must include a symbol");

export const changeOwnPasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1, "currentPassword is required"),
    newPassword: strongPasswordSchema,
  })
  .strict();

export type ChangeOwnPasswordRequestBody = z.infer<
  typeof changeOwnPasswordRequestSchema
>;
