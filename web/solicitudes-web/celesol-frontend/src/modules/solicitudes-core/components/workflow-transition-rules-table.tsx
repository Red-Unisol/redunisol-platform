import { useMemo, useState } from "react";

import { WorkflowTransitionEditDialog } from "@/modules/solicitudes-core/components/workflow-transition-edit-dialog";
import type {
  WorkflowTransitionAdminRecord,
  WorkflowTransitionAdminStateGroup,
} from "@/modules/solicitudes-core/services/workflow-transition-admin-api";
import { Button } from "@/shared/components/ui/button";

type WorkflowTransitionRow = {
  fromState: WorkflowTransitionAdminStateGroup["fromState"];
  transition: WorkflowTransitionAdminRecord;
};

type WorkflowTransitionRulesTableProps = {
  searchTerm: string;
  states: WorkflowTransitionAdminStateGroup[];
};

export function WorkflowTransitionRulesTable({
  searchTerm,
  states,
}: WorkflowTransitionRulesTableProps) {
  const rows = useMemo<WorkflowTransitionRow[]>(
    () =>
      states.flatMap((stateGroup) =>
        stateGroup.transitions.map((transition) => ({
          fromState: stateGroup.fromState,
          transition,
        })),
      ),
    [states],
  );
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    if (normalizedSearchTerm.length === 0) {
      return rows;
    }

    return rows.filter(({ fromState, transition }) =>
      [
        fromState.name,
        fromState.owner.name,
        transition.toState.name,
        transition.actionCode,
        transition.actionLabel,
        transition.description ?? "",
        transition.defaultComment ?? "",
      ].some((value) => value.toLowerCase().includes(normalizedSearchTerm)),
    );
  }, [normalizedSearchTerm, rows]);
  const [selectedRow, setSelectedRow] = useState<WorkflowTransitionRow | null>(
    null,
  );

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto pb-3">
          <table className="min-w-[1220px] w-full divide-y divide-border text-sm">
            <thead className="bg-muted/30 text-left text-[12px] text-foreground-secondary">
              <tr>
                <th className="px-3 py-2 font-medium">Estado origen</th>
                <th className="px-3 py-2 font-medium">Estado destino</th>
                <th className="px-3 py-2 font-medium">Transición</th>
                <th className="px-3 py-2 font-medium">Comentario automático</th>
                <th className="px-3 py-2 font-medium">Requiere comentario</th>
                <th className="px-3 py-2 font-medium">Nombre visible</th>
                <th className="px-3 py-2 font-medium">Orden</th>
                <th className="px-3 py-2 font-medium">Descripción</th>
                <th className="px-3 py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-6 text-center text-sm text-foreground-secondary"
                    colSpan={9}
                  >
                    No hay transiciones que coincidan con la búsqueda.
                  </td>
                </tr>
              ) : null}

              {filteredRows.map((row) => {
                const { fromState, transition } = row;

                return (
                  <tr
                    className="bg-background/40 align-middle transition hover:bg-muted/10"
                    key={transition.id}
                  >
                    <td className="px-3 py-2 text-foreground">
                      <div className="min-w-36">
                        <p
                          className="truncate font-medium"
                          title={fromState.name}
                        >
                          {fromState.name}
                        </p>
                        <p
                          className="truncate text-[11px] text-foreground-secondary"
                          title={fromState.owner.name}
                        >
                          {fromState.owner.name}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      <span
                        className="block max-w-40 truncate"
                        title={transition.toState.name}
                      >
                        {transition.toState.name}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <code
                        className="inline-flex max-w-44 truncate rounded-full border border-border bg-muted/40 px-2 py-1 text-[11px] text-foreground-secondary"
                        title={transition.actionCode}
                      >
                        {transition.actionCode}
                      </code>
                    </td>
                    <td className="px-3 py-2 text-foreground-secondary">
                      <span
                        className="block max-w-64 truncate"
                        title={
                          transition.defaultComment ??
                          "Sin comentario automático"
                        }
                      >
                        {transition.defaultComment?.trim() ||
                          "Sin comentario automático"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${
                          transition.requiresComment
                            ? "bg-amber-100 text-amber-800"
                            : "bg-muted text-foreground-secondary"
                        }`}
                      >
                        {transition.requiresComment ? "Sí" : "No"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      <span
                        className="block max-w-48 truncate"
                        title={transition.actionLabel}
                      >
                        {transition.actionLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-foreground-secondary">
                      {transition.sortOrder}
                    </td>
                    <td className="px-3 py-2 text-foreground-secondary">
                      <span
                        className="block max-w-60 truncate"
                        title={transition.description ?? "Sin descripción"}
                      >
                        {transition.description?.trim() || "Sin descripción"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        onClick={() => setSelectedRow(row)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Editar
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <WorkflowTransitionEditDialog
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRow(null);
          }
        }}
        open={selectedRow !== null}
        row={selectedRow}
      />
    </>
  );
}
