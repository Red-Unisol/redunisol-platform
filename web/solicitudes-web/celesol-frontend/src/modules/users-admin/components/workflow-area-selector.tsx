import { Checkbox } from "@/shared/components/ui/checkbox";
import { areaName } from "@/modules/auth/utils/auth-user";
import type { WorkflowOwner } from "../services/users-admin-api";

const INTERNAL_AREAS = new Set(["RIESGO", "TESORERIA", "LEGAJOS_DIGITALES"]);

export function WorkflowAreaSelector({
  owners,
  selected,
  initialSelection = [],
  onChange,
  disabled,
}: {
  owners: WorkflowOwner[];
  selected: string[];
  initialSelection?: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const analysis = owners.find(owner => owner.code === "RIESGO");
  const addsAnalysis = !!analysis && selected.includes(analysis.id) && !initialSelection.includes(analysis.id);
  const removesAnalysis = !!analysis && !selected.includes(analysis.id) && initialSelection.includes(analysis.id);
  const hasExclusive = owners.some(
    (owner) => selected.includes(owner.id) && !INTERNAL_AREAS.has(owner.code),
  );
  return (
    <fieldset disabled={disabled} className="space-y-1.5">
      <legend className="mb-1 text-sm font-medium text-foreground">
        Áreas
      </legend>
      {owners.map((owner) => {
        const checked = selected.includes(owner.id);
        const incompatible =
          !checked &&
          selected.length > 0 &&
          (hasExclusive || !INTERNAL_AREAS.has(owner.code));
        return (
          <label
            key={owner.id}
            className="flex min-h-8 items-center gap-2 text-sm has-[:disabled]:text-foreground-muted"
          >
            <Checkbox
              checked={checked}
              disabled={disabled || incompatible}
              onCheckedChange={(next) =>
                onChange(
                  next === true
                    ? [...selected, owner.id]
                    : selected.filter((id) => id !== owner.id),
                )
              }
            />
            {areaName(owner)}
          </label>
        );
      })}
      <p className="text-xs text-foreground-secondary">
        Análisis, Tesorería y Legajos Digitales se pueden combinar. Las demás
        áreas se asignan individualmente.
      </p>
      <div aria-live="polite" className="text-xs text-foreground-secondary">
        {addsAnalysis && "Al guardar, entrará al reparto automático de Análisis."}
        {removesAnalysis && "Al guardar, saldrá del reparto automático de Análisis."}
      </div>
    </fieldset>
  );
}
