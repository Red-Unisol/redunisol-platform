import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SolicitudFieldAccessAdminPrismaDatasource } from "./SolicitudFieldAccessAdminPrismaDatasource";

type StoredRuleRecord = {
  active: boolean;
  backgroundColor: string | null;
  canManageAttachments: boolean;
  defaultMode: "readonly";
  editableFields: string[];
  editableGroups: string[];
  readonlyReason: string | null;
  textColor: string | null;
  updatedAt: Date;
  updatedBy: string;
  version: number;
  workflowStateId: string;
};

type StoredStateRecord = {
  code: string;
  id: string;
  name: string;
};

type RuleCreateInput = {
  data: Omit<StoredRuleRecord, "updatedAt">;
};

type RuleLookupInput = {
  where: {
    workflowStateId: string;
  };
};

type RuleUpdateManyInput = {
  data: Partial<Omit<StoredRuleRecord, "workflowStateId" | "updatedAt">>;
  where: {
    version: number;
    workflowStateId: string;
  };
};

type AuditCreateInput = {
  data: Record<string, unknown>;
};

type WorkflowStateLookupInput = {
  where: {
    id: string;
  };
};

type TransactionClient = {
  solicitudFieldAccessRule: {
    create: (input: RuleCreateInput) => Promise<StoredRuleRecord>;
    findUnique: (input: RuleLookupInput) => Promise<StoredRuleRecord | null>;
    findUniqueOrThrow: (input: RuleLookupInput) => Promise<StoredRuleRecord>;
    updateMany: (input: RuleUpdateManyInput) => Promise<{ count: number }>;
  };
  solicitudFieldAccessRuleAudit: {
    create: (input: AuditCreateInput) => Promise<Record<string, unknown>>;
  };
  workflowState: {
    findUnique: (
      input: WorkflowStateLookupInput,
    ) => Promise<StoredStateRecord | null>;
  };
};

describe("SolicitudFieldAccessAdminPrismaDatasource", () => {
  it("rolls back rule changes when audit insertion fails", async () => {
    const store = createTransactionalStore({ failAudit: true });
    const datasource = new SolicitudFieldAccessAdminPrismaDatasource(
      store.prisma as never,
    );

    await assert.rejects(
      () =>
        datasource.saveRuleWithAudit({
          expectedVersion: 1,
          nextRule: {
            active: true,
            backgroundColor: null,
            canManageAttachments: true,
            defaultMode: "readonly",
            editableFields: ["solicitud.motivo"],
            editableGroups: [],
            readonlyReason: null,
            textColor: null,
          },
          updatedBy: "admin-1",
          workflowStateId: "state-1",
        }),
      /audit-failed/,
    );

    assert.deepEqual(store.rules.get("state-1"), {
      active: true,
      backgroundColor: null,
      canManageAttachments: true,
      defaultMode: "readonly",
      editableFields: ["solicitud.motivo", "titular.nombre"],
      editableGroups: ["garantias"],
      readonlyReason: null,
      textColor: null,
      updatedAt: new Date("2026-06-04T10:00:00.000Z"),
      updatedBy: "seed",
      version: 1,
      workflowStateId: "state-1",
    });
    assert.equal(store.audits.length, 0);
  });
});

function createTransactionalStore(options?: { failAudit?: boolean }) {
  const rules = new Map<string, StoredRuleRecord>([
    [
      "state-1",
      {
        active: true,
        backgroundColor: null,
        canManageAttachments: true,
        defaultMode: "readonly",
        editableFields: ["solicitud.motivo", "titular.nombre"],
        editableGroups: ["garantias"],
        readonlyReason: null,
        textColor: null,
        updatedAt: new Date("2026-06-04T10:00:00.000Z"),
        updatedBy: "seed",
        version: 1,
        workflowStateId: "state-1",
      },
    ],
  ]);
  const states = new Map<string, StoredStateRecord>([
    [
      "state-1",
      {
        code: "CargaVendedor",
        id: "state-1",
        name: "CargaVendedor",
      },
    ],
  ]);
  const audits: Record<string, unknown>[] = [];

  const prisma = {
    async $transaction<T>(callback: (tx: TransactionClient) => Promise<T>) {
      const txRules = new Map(
        Array.from(rules.entries(), ([key, value]) => [
          key,
          {
            ...value,
            editableFields: [...value.editableFields],
            editableGroups: [...value.editableGroups],
            updatedAt: new Date(value.updatedAt),
          },
        ]),
      );
      const txAudits = [...audits];
      const tx: TransactionClient = {
        solicitudFieldAccessRule: {
          create: async ({ data }: RuleCreateInput) => {
            const record = { ...data, updatedAt: new Date("2026-06-04T11:00:00.000Z") };
            txRules.set(data.workflowStateId, record);
            return record;
          },
          findUnique: async ({ where }: RuleLookupInput) =>
            txRules.get(where.workflowStateId) ?? null,
          findUniqueOrThrow: async ({ where }: RuleLookupInput) => {
            const rule = txRules.get(where.workflowStateId);
            if (!rule) {
              throw new Error("missing");
            }
            return rule;
          },
          updateMany: async ({ data, where }: RuleUpdateManyInput) => {
            const current = txRules.get(where.workflowStateId);
            if (!current || current.version !== where.version) {
              return { count: 0 };
            }
            txRules.set(where.workflowStateId, {
              ...current,
              ...data,
              updatedAt: new Date("2026-06-04T11:00:00.000Z"),
            });
            return { count: 1 };
          },
        },
        solicitudFieldAccessRuleAudit: {
          create: async ({ data }: AuditCreateInput) => {
            if (options?.failAudit) {
              throw new Error("audit-failed");
            }
            txAudits.push(data);
            return data;
          },
        },
        workflowState: {
          findUnique: async ({ where }: WorkflowStateLookupInput) =>
            states.get(where.id) ?? null,
        },
      };

      const result = await callback(tx);
      rules.clear();
      for (const [key, value] of txRules) {
        rules.set(key, value);
      }
      audits.splice(0, audits.length, ...txAudits);

      return result;
    },
  };

  return { audits, prisma, rules };
}
