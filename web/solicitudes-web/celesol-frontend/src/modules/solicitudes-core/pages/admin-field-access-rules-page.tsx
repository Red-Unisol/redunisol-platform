import { useMemo, useState } from "react";
import { Lock, PencilLine, Settings2 } from "lucide-react";

import { FieldAccessRuleEditor } from "@/modules/solicitudes-core/components/field-access-rule-editor";
import { FieldAccessRulesTable } from "@/modules/solicitudes-core/components/field-access-rules-table";
import { useFieldAccessFieldsQuery } from "@/modules/solicitudes-core/hooks/use-field-access-fields-query";
import { useFieldAccessRuleQuery } from "@/modules/solicitudes-core/hooks/use-field-access-rule-query";
import { useFieldAccessRulesQuery } from "@/modules/solicitudes-core/hooks/use-field-access-rules-query";
import type { FieldAccessRulesListItem } from "@/modules/solicitudes-core/services/field-access-admin-api";
import { Button } from "@/shared/components/ui/button";
import { TableEmptyState } from "@/shared/components/ui/table-empty-state";
import { TableLoader } from "@/shared/components/ui/table-loader";

type ViewMode = "list" | "edit";
type ListFilter = "all" | "editable" | "readonly";
const EMPTY_RULES: FieldAccessRulesListItem[] = [];

const LIST_FILTERS: Array<{ label: string; value: ListFilter }> = [
  { label: "Todos", value: "all" },
  { label: "Editables", value: "editable" },
  { label: "Solo lectura", value: "readonly" },
];

export function AdminFieldAccessRulesPage() {
  const rulesQuery = useFieldAccessRulesQuery();
  const fieldsQuery = useFieldAccessFieldsQuery();
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedStateCode, setSelectedStateCode] = useState<string | null>(
    null,
  );
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const ruleQuery = useFieldAccessRuleQuery(
    selectedStateCode ?? "",
    selectedStateCode !== null && viewMode === "edit",
  );

  const isLoading = rulesQuery.isLoading || fieldsQuery.isLoading;
  const hasLoadError = rulesQuery.isError || fieldsQuery.isError;
  const rules = rulesQuery.data?.rules ?? EMPTY_RULES;
  const summary = useMemo(() => {
    return buildSummaryCards(rules);
  }, [rules]);
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const filteredRules = useMemo(() => {
    return rules.filter((item) => {
      const matchesSearch =
        normalizedSearchTerm.length === 0 ||
        item.state.name.toLowerCase().includes(normalizedSearchTerm) ||
        item.state.ownerName.toLowerCase().includes(normalizedSearchTerm);

      const hasEditableValues =
        item.resolvedFieldAccess.editableFields.length > 0 ||
        item.resolvedFieldAccess.editableGroups.length > 0;
      const matchesFilter =
        listFilter === "all" ||
        (listFilter === "editable" && hasEditableValues) ||
        (listFilter === "readonly" && !hasEditableValues);

      return matchesSearch && matchesFilter;
    });
  }, [listFilter, normalizedSearchTerm, rules]);
  const hasActiveFilters =
    normalizedSearchTerm.length > 0 || listFilter !== "all";

  function handleSelectState(stateCode: string) {
    setSelectedStateCode(stateCode);
    setViewMode("edit");
  }

  function handleBackToList() {
    setViewMode("list");
  }

  async function handleRefreshEditingState() {
    await Promise.all([
      rulesQuery.refetch(),
      selectedStateCode ? ruleQuery.refetch() : Promise.resolve(),
    ]);
  }

  return (
    <article className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      {viewMode === "list" ? (
        <header className="border-b border-border bg-muted/20 px-4 py-5 md:px-6">
          <div className="space-y-3">
            <div className="inline-flex rounded-full border border-border bg-background px-3 py-1 text-[11px] font-medium tracking-[0.12em] text-foreground-secondary uppercase">
              {"Solicitudes \u00b7 Administraci\u00f3n"}
            </div>
            <div className="space-y-2">
              <h1 className="text-[1.9rem] leading-none font-semibold text-foreground">
                {"Administraci\u00f3n de permisos de edici\u00f3n"}
              </h1>
              <p className="max-w-4xl text-sm leading-6 text-foreground-secondary">
                {
                  "Revis\u00e1 qu\u00e9 estados permiten edici\u00f3n, cu\u00e1les quedan en solo lectura y qu\u00e9 configuraci\u00f3n tiene cada uno."
                }
              </p>
            </div>
          </div>
        </header>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto bg-background/30 p-3 md:p-4 lg:p-5">
        {isLoading ? (
          <TableLoader
            className="py-10"
            label="Cargando configuraciones de permisos..."
          />
        ) : hasLoadError ? (
          <p className="text-sm text-destructive">
            {
              "No se pudo cargar la configuraci\u00f3n de permisos de edici\u00f3n."
            }
          </p>
        ) : !rulesQuery.data || !fieldsQuery.data ? (
          <TableEmptyState message="No hay configuraciones para mostrar." />
        ) : viewMode === "list" ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {summary.map((card) => (
                <section
                  className="rounded-xl border border-border bg-surface px-4 py-4 shadow-sm"
                  key={card.label}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-[11px] font-medium tracking-[0.12em] text-foreground-secondary uppercase">
                        {card.label}
                      </p>
                      <p className="text-[1.85rem] leading-none font-semibold text-foreground">
                        {card.value}
                      </p>
                    </div>
                    <div className="rounded-full border border-border bg-muted/40 p-2">
                      <card.icon className="size-4 text-foreground-secondary" />
                    </div>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-foreground-secondary">
                    {card.description}
                  </p>
                </section>
              ))}
            </div>

            <section className="space-y-4 rounded-xl border border-border bg-surface p-4 shadow-sm">
              <div className="space-y-1.5">
                <h2 className="text-lg font-semibold text-foreground">
                  Estados y configuraciones
                </h2>
                <p className="max-w-3xl text-sm leading-6 text-foreground-secondary">
                  {
                    "Encontr\u00e1 r\u00e1pido qu\u00e9 estado quer\u00e9s revisar y abr\u00ed su configuraci\u00f3n de permisos."
                  }
                </p>
              </div>

              <div className="flex flex-col gap-3 rounded-xl border border-border bg-background/70 p-3 md:flex-row md:items-end md:justify-between">
                <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground-secondary">
                    Buscar por estado o área
                  </span>
                  <input
                    className="flex h-9 w-full min-w-0 rounded-md border border-input-border bg-input-background px-3 py-1 text-sm text-foreground shadow-xs transition outline-none placeholder:text-foreground-muted focus-visible:border-input-focus focus-visible:ring-2 focus-visible:ring-input-focus/20"
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Ej.: Carga vendedor o Comercial"
                    type="search"
                    value={searchTerm}
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  {LIST_FILTERS.map((filterOption) => {
                    const isActive = listFilter === filterOption.value;

                    return (
                      <Button
                        key={filterOption.value}
                        onClick={() => setListFilter(filterOption.value)}
                        size="sm"
                        type="button"
                        variant={isActive ? "default" : "outline"}
                      >
                        {filterOption.label}
                      </Button>
                    );
                  })}
                </div>
              </div>

              {hasActiveFilters ? (
                <p className="text-xs text-foreground-secondary">
                  Mostrando {filteredRules.length} de {rules.length} estados.
                </p>
              ) : null}

              <FieldAccessRulesTable
                onSelect={handleSelectState}
                rules={filteredRules}
                selectedStateCode={selectedStateCode}
              />
            </section>
          </div>
        ) : ruleQuery.isLoading ? (
          <section className="rounded-md border border-border p-4">
            <p className="text-sm text-foreground-secondary">
              {"Cargando configuraci\u00f3n..."}
            </p>
          </section>
        ) : ruleQuery.data ? (
          <FieldAccessRuleEditor
            blockedFields={fieldsQuery.data.blockedFields}
            catalog={fieldsQuery.data}
            isRuleLoading={ruleQuery.isLoading}
            key={`${selectedStateCode ?? "empty"}:${ruleQuery.data.rule?.version ?? 0}`}
            onBack={handleBackToList}
            onRulesRefresh={handleRefreshEditingState}
            selectedRule={ruleQuery.data}
          />
        ) : (
          <section className="rounded-md border border-border p-4">
            <p className="text-sm text-destructive">
              {
                "No se pudo cargar la configuraci\u00f3n del estado seleccionado."
              }
            </p>
          </section>
        )}
      </div>
    </article>
  );
}

function buildSummaryCards(rules: FieldAccessRulesListItem[]) {
  const configured = rules.filter((item) => item.source === "persisted").length;
  const editable = rules.filter(
    (item) =>
      item.resolvedFieldAccess.editableFields.length > 0 ||
      item.resolvedFieldAccess.editableGroups.length > 0,
  ).length;
  const readonly = rules.length - editable;
  return [
    {
      description:
        "Tienen una configuraci\u00f3n guardada disponible para usar.",
      icon: Settings2,
      label: "Estados configurados",
      value: configured,
    },
    {
      description: "Permiten editar al menos un dato en la solicitud.",
      icon: PencilLine,
      label: "Estados editables",
      value: editable,
    },
    {
      description: "No tienen datos habilitados para editar en este estado.",
      icon: Lock,
      label: "Estados solo lectura",
      value: readonly,
    },
  ];
}
