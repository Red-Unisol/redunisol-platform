const fieldAccessAdminRootKey = [
  "solicitudes-core",
  "field-access-admin",
] as const;

export const fieldAccessAdminQueryKeys = {
  all: fieldAccessAdminRootKey,
  fields: [...fieldAccessAdminRootKey, "fields"] as const,
  rule: (stateCode: string) =>
    [...fieldAccessAdminRootKey, "rule", stateCode] as const,
  rules: [...fieldAccessAdminRootKey, "rules"] as const,
};
