import { z } from "zod";

const strongPasswordSchema = z
  .string()
  .min(8, "password must be at least 8 characters")
  .regex(/[a-z]/, "password must include a lowercase letter")
  .regex(/[A-Z]/, "password must include an uppercase letter")
  .regex(/[0-9]/, "password must include a number")
  .regex(/[^A-Za-z0-9]/, "password must include a symbol");

export const registerRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email("email must be valid"),
  firstName: z.string().trim().min(1, "firstName is required"),
  lastName: z.string().trim().min(1, "lastName is required"),
  legacyUser: z.string().trim().min(1, "legacyUser is required"),
  password: strongPasswordSchema,
});

export type RegisterRequestBody = z.infer<typeof registerRequestSchema>;
