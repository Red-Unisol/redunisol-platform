import { z } from "zod";

export const integrationConfigSchema = z
  .object({
    tokenSha256: z
      .string()
      .regex(/^([a-fA-F0-9]{64})?$/)
      .default(""),
    userId: z.union([z.string().uuid(), z.literal("")]).default(""),
    clientId: z.string().trim().min(1).max(100).default("transferencias"),
  })
  .refine((value) => Boolean(value.tokenSha256) === Boolean(value.userId), {
    message: "Token hash and service user must be configured together.",
  });
export type IntegrationConfig = z.infer<typeof integrationConfigSchema>;
