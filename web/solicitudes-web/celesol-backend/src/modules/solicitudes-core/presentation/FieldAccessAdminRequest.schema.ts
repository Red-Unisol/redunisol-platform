import { z } from "zod";

export const fieldAccessRuleStateCodeParamsSchema = z
  .object({
    stateCode: z.string().trim().min(1),
  })
  .strict();

const fieldAccessRuleBodyShape = {
  active: z.boolean().optional(),
  backgroundColor: z.string().trim().min(1).nullable().optional(),
  canManageAttachments: z.boolean(),
  editableFields: z.array(z.string()),
  editableGroups: z.array(z.string()),
  readonlyReason: z.string().trim().min(1).nullable().optional(),
  textColor: z.string().trim().min(1).nullable().optional(),
};

export const updateFieldAccessRuleBodySchema = z
  .object({
    ...fieldAccessRuleBodyShape,
    active: z.boolean(),
    version: z.number().int().nonnegative(),
  })
  .strict();

export type FieldAccessRuleStateCodeParams = z.infer<
  typeof fieldAccessRuleStateCodeParamsSchema
>;
export type UpdateFieldAccessRuleBody = z.infer<
  typeof updateFieldAccessRuleBodySchema
>;
