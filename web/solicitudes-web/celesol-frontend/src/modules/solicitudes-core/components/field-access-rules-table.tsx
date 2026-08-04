import { Button } from "@/shared/components/ui/button";
import { TableEmptyState } from "@/shared/components/ui/table-empty-state";

import type { FieldAccessRulesListItem } from "@/modules/solicitudes-core/services/field-access-admin-api";
import {
  getBadgeClasses,
  getFieldAccessActiveStatus,
  getFieldAccessEffectiveAccess,
} from "@/modules/solicitudes-core/utils/field-access-admin-labels";

type FieldAccessRulesTableProps = {
  onSelect: (stateCode: string) => void;
  rules: FieldAccessRulesListItem[];
  selectedStateCode: string | null;
};

export function FieldAccessRulesTable({
  onSelect,
  rules,
  selectedStateCode,
}: FieldAccessRulesTableProps) {
  if (rules.length === 0) {
    return (
      <TableEmptyState message="No hay configuraciones de permisos para mostrar." />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-muted/35">
          <tr>
            <th className="px-4 py-2.5 text-left text-[11px] font-medium tracking-[0.12em] text-foreground-secondary uppercase">
              Estado
            </th>
            <th className="px-4 py-2.5 text-left text-[11px] font-medium tracking-[0.12em] text-foreground-secondary uppercase">
              {"\u00c1rea responsable"}
            </th>
            <th className="px-4 py-2.5 text-left text-[11px] font-medium tracking-[0.12em] text-foreground-secondary uppercase">
              Regla
            </th>
            <th className="px-4 py-2.5 text-left text-[11px] font-medium tracking-[0.12em] text-foreground-secondary uppercase">
              Campos habilitados
            </th>
            <th className="px-4 py-2.5 text-left text-[11px] font-medium tracking-[0.12em] text-foreground-secondary uppercase">
              Grupos habilitados
            </th>
            <th className="px-4 py-2.5 text-left text-[11px] font-medium tracking-[0.12em] text-foreground-secondary uppercase">
              {"Acci\u00f3n"}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rules.map((item) => {
            const isSelected = item.state.code === selectedStateCode;
            const effectiveAccess = getFieldAccessEffectiveAccess(item);
            const activeStatus = getFieldAccessActiveStatus(
              item.rule?.active ?? false,
            );

            return (
              <tr
                className={`transition ${isSelected ? "bg-muted/45" : "bg-surface hover:bg-muted/20"}`}
                key={item.state.id}
              >
                <td className="px-4 py-3 text-foreground">
                  <div className="font-medium">{item.state.name}</div>
                  <div className="mt-0.5 text-xs text-foreground-secondary">
                    {item.state.isTerminal
                      ? "Estado final"
                      : "Estado operativo"}
                  </div>
                </td>
                <td className="px-4 py-3 text-foreground">
                  <div className="font-medium">{item.state.ownerName}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5 xl:max-w-[14rem]">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${getBadgeClasses(activeStatus.tone)}`}
                    >
                      {activeStatus.label}
                    </span>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${getBadgeClasses(effectiveAccess.tone)}`}
                    >
                      {effectiveAccess.label}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-foreground">
                  <div className="inline-flex min-w-10 items-center justify-center rounded-full border border-border bg-background px-2 py-1 text-xs font-medium">
                    {item.resolvedFieldAccess.editableFields.length}
                  </div>
                </td>
                <td className="px-4 py-3 text-foreground">
                  <div className="inline-flex min-w-10 items-center justify-center rounded-full border border-border bg-background px-2 py-1 text-xs font-medium">
                    {item.resolvedFieldAccess.editableGroups.length}
                  </div>
                </td>
                <td className="px-4 py-3 text-foreground">
                  <Button
                    onClick={() => onSelect(item.state.code)}
                    size="sm"
                    type="button"
                    variant={isSelected ? "default" : "outline"}
                  >
                    Editar permisos
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
