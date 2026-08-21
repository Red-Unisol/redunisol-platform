import { z } from "zod";

export const requestPasswordResetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email("email must be valid"),
});

export type RequestPasswordResetRequestBody = z.infer<
  typeof requestPasswordResetRequestSchema
>;
