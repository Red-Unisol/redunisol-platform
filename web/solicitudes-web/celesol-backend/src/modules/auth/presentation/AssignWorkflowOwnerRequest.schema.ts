import { z } from "zod";

const uuidLikeSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
);

export const assignWorkflowOwnerParamsSchema = z.object({
  id: uuidLikeSchema,
});

export const assignWorkflowOwnerBodySchema = z.object({
  workflowOwnerId: uuidLikeSchema.nullable(),
});

export const assignWorkflowOwnersBodySchema = z.object({
  workflowOwnerIds: z.array(uuidLikeSchema.transform(id => id.toLowerCase())).max(3)
    .refine(ids => new Set(ids).size === ids.length, "Las áreas no pueden repetirse."),
});

export type AssignWorkflowOwnerParams = z.infer<
  typeof assignWorkflowOwnerParamsSchema
>;
export type AssignWorkflowOwnerBody = z.infer<
  typeof assignWorkflowOwnerBodySchema
>;
