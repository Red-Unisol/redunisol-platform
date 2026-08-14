import { Checkbox } from "@/shared/components/ui/checkbox";

import {
  getFieldAccessFieldLabel,
  getFieldAccessSectionTitle,
} from "@/modules/solicitudes-core/utils/field-access-admin-labels";

type FieldAccessFieldGroupSectionProps = {
  fields: string[];
  onToggleAllFields: (fieldKeys: string[], checked: boolean) => void;
  onToggleField: (fieldKey: string) => void;
  selectedFields: string[];
  title: string;
};

export function FieldAccessFieldGroupSection({
  fields,
  onToggleAllFields,
  onToggleField,
  selectedFields,
  title,
}: FieldAccessFieldGroupSectionProps) {
  const selectedCount = fields.filter((fieldKey) =>
    selectedFields.includes(fieldKey),
  ).length;
  const allSelected = fields.length > 0 && selectedCount === fields.length;
  const someSelected = selectedCount > 0 && selectedCount < fields.length;

  function handleToggleAll(checked: boolean | "indeterminate") {
    const shouldSelect = checked === true || checked === "indeterminate";
    onToggleAllFields(fields, shouldSelect);
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-background p-4 shadow-xs">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {getFieldAccessSectionTitle(title)}
            </h3>
            <span className="inline-flex rounded-full border border-border bg-muted/35 px-2 py-0.5 text-[11px] font-medium text-foreground-secondary">
              {selectedCount}/{fields.length} habilitados
            </span>
          </div>
          <p className="text-xs leading-5 text-foreground-secondary">
            Elegí los datos que podrán editarse en esta sección.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-lg border border-border bg-muted/25 px-3 py-2.5 text-sm text-foreground">
            <Checkbox
              checked={
                allSelected ? true : someSelected ? "indeterminate" : false
              }
              onCheckedChange={handleToggleAll}
            />
            <span className="space-y-0.5">
              <span className="block font-medium">Toda la sección</span>
              <span className="block text-xs text-foreground-secondary">
                {selectedCount === 0
                  ? "No hay campos seleccionados."
                  : selectedCount === fields.length
                    ? "Todos los campos quedarán habilitados."
                    : `${selectedCount} campos seleccionados.`}
              </span>
            </span>
          </label>
        </div>
      </header>

      <div className="grid gap-2.5 sm:grid-cols-2">
        {fields.map((fieldKey) => (
          <label
            className="flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground transition hover:border-primary/30 hover:bg-muted/35"
            key={fieldKey}
          >
            <Checkbox
              checked={selectedFields.includes(fieldKey)}
              onCheckedChange={() => onToggleField(fieldKey)}
            />
            <span className="min-w-0 leading-snug">
              {getFieldAccessFieldLabel(fieldKey)}
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
