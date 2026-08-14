import { z } from "zod";

export const loginRequestSchema = z.object({
  identifier: z.string().trim().min(1, "identifier is required"),
  password: z.string().min(1, "password is required"),
});

export type LoginRequestBody = z.infer<typeof loginRequestSchema>;
