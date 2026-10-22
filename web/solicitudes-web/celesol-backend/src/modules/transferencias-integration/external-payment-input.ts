import { z } from "zod";

export const externalPaymentInput = z
  .object({
    requestId: z.uuid(),
    paidOn: z.iso.date(),
    reference: z.string().trim().max(200).optional().default(""),
    comment: z.string().trim().max(4000).optional().default(""),
  })
  .strict();

export type ExternalPaymentInput = z.infer<typeof externalPaymentInput>;
