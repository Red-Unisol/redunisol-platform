import { useState } from "react";

import { WorkflowTransitionRulesTable } from "@/modules/solicitudes-core/components/workflow-transition-rules-table";
import { useWorkflowTransitionRulesQuery } from "@/modules/solicitudes-core/hooks/use-workflow-transition-rules-query";
import type { WorkflowTransitionAdminStateGroup } from "@/modules/solicitudes-core/services/workflow-transition-admin-api";
import { Input } from "@/shared/components/ui/input";
import { TableEmptyState } from "@/shared/components/ui/table-empty-state";
import { TableLoader } from "@/shared/components/ui/table-loader";

const EMPTY_STATES: WorkflowTransitionAdminStateGroup[] = [];

export function AdminWorkflowTransitionsPage() {
  const statesQuery = useWorkflowTransitionRulesQuery();
  const [searchTerm, setSearchTerm] = useState("");
  const states = statesQuery.data?.states ?? EMPTY_STATES;

  return (
    <article className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <header className="border-b border-border bg-muted/20 px-4 py-5 md:px-6">
        <div className="space-y-3">
          <div className="inline-flex rounded-full border border-border bg-background px-3 py-1 text-[11px] font-medium tracking-[0.12em] text-foreground-secondary uppercase">
            Solicitudes · Administración
          </div>
          <div className="space-y-2">
            <h1 className="text-[1.9rem] leading-none font-semibold text-foreground">
              Administración de transiciones
            </h1>
            <p className="max-w-4xl text-sm leading-6 text-foreground-secondary">
              Configurá las acciones disponibles por estado y el comentario
              automático que se registra al ejecutarlas.
            </p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto bg-background/30 p-3 md:p-4 lg:p-5">
        {statesQuery.isLoading ? (
          <TableLoader
            className="py-10"
            label="Cargando configuración de transiciones..."
          />
        ) : statesQuery.isError ? (
          <p className="text-sm text-destructive">
            No se pudo cargar la configuración de transiciones.
          </p>
        ) : !states.length ? (
          <TableEmptyState message="No hay transiciones para mostrar." />
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
              <label className="grid max-w-md gap-1.5">
                <span className="text-xs font-medium text-foreground-secondary">
                  Buscar por estado, área o transición
                </span>
                <Input
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Ej.: Carga vendedor, Riesgo o enviar_revision"
                  type="search"
                  value={searchTerm}
                />
              </label>
            </div>

            <WorkflowTransitionRulesTable
              searchTerm={searchTerm}
              states={states}
            />
          </div>
        )}
      </div>
    </article>
  );
}
