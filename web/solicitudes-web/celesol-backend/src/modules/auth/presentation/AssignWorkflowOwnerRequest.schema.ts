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

export type AssignWorkflowOwnerParams = z.infer<
  typeof assignWorkflowOwnerParamsSchema
>;
export type AssignWorkflowOwnerBody = z.infer<
  typeof assignWorkflowOwnerBodySchema
>;
