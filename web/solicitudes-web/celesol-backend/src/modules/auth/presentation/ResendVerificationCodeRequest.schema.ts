import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

export const resendVerificationCodeRequestSchema = z
  .object({
    email: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.string().trim().toLowerCase().email("email must be valid").optional(),
    ),
    identifier: optionalNonEmptyString,
  })
  .refine((value) => Boolean(value.identifier || value.email), {
    message: "identifier or email is required",
    path: ["identifier"],
  });

export type ResendVerificationCodeRequestBody = z.infer<
  typeof resendVerificationCodeRequestSchema
>;
