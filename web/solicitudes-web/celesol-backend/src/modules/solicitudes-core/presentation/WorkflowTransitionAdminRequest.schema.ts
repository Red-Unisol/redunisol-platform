import { z } from "zod";

export const workflowTransitionStateCodeParamsSchema = z
  .object({
    stateCode: z.string().trim().min(1),
  })
  .strict();

export const workflowTransitionIdParamsSchema = z
  .object({
    transitionId: z.string().uuid(),
  })
  .strict();

export const updateWorkflowTransitionBodySchema = z
  .object({
    actionLabel: z.string().trim().min(1),
    description: z.string().trim().nullable(),
    sortOrder: z.number().int().nonnegative(),
    defaultComment: z.string().trim().nullable(),
    requiresComment: z.boolean(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type WorkflowTransitionStateCodeParams = z.infer<
  typeof workflowTransitionStateCodeParamsSchema
>;
export type WorkflowTransitionIdParams = z.infer<
  typeof workflowTransitionIdParamsSchema
>;
export type UpdateWorkflowTransitionBody = z.infer<
  typeof updateWorkflowTransitionBodySchema
>;
