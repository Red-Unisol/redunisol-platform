import { type ReactNode, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleCheckBig,
  FileText,
  Eye,
  Layers3,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import { SketchPicker, type ColorResult } from "react-color";
import { toast } from "sonner";

import { Checkbox } from "@/shared/components/ui/checkbox";
import { Button } from "@/shared/components/ui/button";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/shared/components/ui/popover";

import { useFieldAccessRuleUpdateMutation } from "@/modules/solicitudes-core/hooks/use-field-access-rule-update-mutation";
import type {
  FieldAccessFieldsResponse,
  FieldAccessRuleDetailResponse,
} from "@/modules/solicitudes-core/services/field-access-admin-api";
import {
  buildFieldAccessRuleUpdatePayload,
  createFieldAccessRuleDraft,
  getFieldAccessAdminErrorMessage,
  removeDraftValue,
  toggleDraftValue,
  validateFieldAccessRuleDraft,
  type FieldAccessRuleDraft,
} from "@/modules/solicitudes-core/utils/field-access-admin-form";
import {
  getBadgeClasses,
  getFieldAccessActiveStatus,
  getFieldAccessFieldLabel,
  getFieldAccessGroupLabel,
  getFieldAccessSourceStatus,
} from "@/modules/solicitudes-core/utils/field-access-admin-labels";
import { ApiError } from "@/shared/services/http/api-error";
import { SubsectionTabs } from "@/modules/solicitudes-editor/components/fields/base";
import { FieldAccessFieldGroupSection } from "./field-access-field-group-section";
import { FieldAccessVersionConflictAlert } from "./field-access-version-conflict-alert";

type FieldAccessRuleEditorProps = {
  blockedFields: string[];
  catalog: FieldAccessFieldsResponse;
  isRuleLoading: boolean;
  onBack: () => void;
  onRulesRefresh: () => Promise<unknown>;
  selectedRule: FieldAccessRuleDetailResponse | null;
};

type EditorTab = "general" | "fields" | "protected" | "appearance";
type FieldsSubtab =
  | "solicitud"
  | "titular"
  | "conyuge"
  | "datosLaborales"
  | "garantias"
  | "adjuntos";

const EDITOR_TABS: Array<{ label: string; value: EditorTab }> = [
  { label: "General", value: "general" },
  { label: "Campos", value: "fields" },
  { label: "Protegidos", value: "protected" },
  { label: "Apariencia", value: "appearance" },
];

const FIELDS_SUBTABS: Array<{ label: string; value: FieldsSubtab }> = [
  { label: "Solicitud", value: "solicitud" },
  { label: "Titular", value: "titular" },
  { label: "Cónyuge", value: "conyuge" },
  { label: "Datos laborales", value: "datosLaborales" },
  { label: "Garantías", value: "garantias" },
  { label: "Adjuntos", value: "adjuntos" },
];

const BACKGROUND_COLOR_PRESETS = [
  { name: "Blanco", value: "#FFFFFF" },
  { name: "Gris claro", value: "#F7F7F7" },
  { name: "Amarillo suave", value: "#FEF3C7" },
  { name: "Azul suave", value: "#DBEAFE" },
  { name: "Verde suave", value: "#DCFCE7" },
  { name: "Rojo suave", value: "#FEE2E2" },
] as const;

const TEXT_COLOR_PRESETS = [
  { name: "Negro", value: "#000000" },
  { name: "Gris oscuro", value: "#374151" },
  { name: "Marrón", value: "#92400E" },
  { name: "Azul oscuro", value: "#1E3A8A" },
  { name: "Verde oscuro", value: "#166534" },
  { name: "Rojo oscuro", value: "#991B1B" },
] as const;

const DEFAULT_BACKGROUND_PREVIEW = "#F7F7F7";
const DEFAULT_TEXT_PREVIEW = "#000000";
const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;
const COLOR_PICKER_POPOVER_SIDE_OFFSET = 8;
const COLOR_PICKER_POPOVER_CLASS_NAME =
  "w-[17.75rem] max-w-[calc(100vw-1.5rem)] rounded-xl border-border bg-background p-2 shadow-xl";

export function FieldAccessRuleEditor({
  blockedFields,
  catalog,
  isRuleLoading,
  onBack,
  onRulesRefresh,
  selectedRule,
}: FieldAccessRuleEditorProps) {
  const updateMutation = useFieldAccessRuleUpdateMutation();
  const [draft, setDraft] = useState<FieldAccessRuleDraft | null>(() =>
    selectedRule ? createFieldAccessRuleDraft(selectedRule, catalog) : null,
  );
  const [tabState, setTabState] = useState<{
    stateCode: string | null;
    tab: EditorTab;
  }>({
    stateCode: selectedRule?.state.code ?? null,
    tab: "general",
  });
  const [fieldsTabState, setFieldsTabState] = useState<{
    stateCode: string | null;
    tab: FieldsSubtab;
  }>({
    stateCode: selectedRule?.state.code ?? null,
    tab: "solicitud",
  });
  const [versionConflictMessage, setVersionConflictMessage] = useState<
    string | null
  >(null);
  const activeTab =
    tabState.stateCode === (selectedRule?.state.code ?? null)
      ? tabState.tab
      : "general";
  const activeFieldsTab =
    fieldsTabState.stateCode === (selectedRule?.state.code ?? null)
      ? fieldsTabState.tab
      : "solicitud";
  const backgroundColorValue = normalizeOptionalDraftColor(
    draft?.backgroundColor,
  );
  const textColorValue = normalizeOptionalDraftColor(draft?.textColor);
  const hasBackgroundColor = backgroundColorValue !== null;
  const hasTextColor = textColorValue !== null;

  const validationIssues = useMemo(() => {
    if (!draft) {
      return [];
    }

    return validateFieldAccessRuleDraft(draft, catalog);
  }, [catalog, draft]);

  function applySectionSelection(fieldKeys: string[], checked: boolean) {
    updateDraft((current) => {
      const currentSet = new Set(current.editableFields);

      if (checked) {
        fieldKeys.forEach((fieldKey) => currentSet.add(fieldKey));
      } else {
        fieldKeys.forEach((fieldKey) => currentSet.delete(fieldKey));
      }

      return {
        ...current,
        editableFields: Array.from(currentSet),
      };
    });
  }

  function clearDerivedState() {
    setVersionConflictMessage(null);
  }

  function updateDraft(
    recipe: (current: FieldAccessRuleDraft) => FieldAccessRuleDraft,
  ) {
    clearDerivedState();
    setDraft((current) => {
      if (!current) {
        return current;
      }

      return recipe(current);
    });
  }

  async function handleSave() {
    if (!draft || validationIssues.length > 0) {
      return;
    }

    try {
      await updateMutation.mutateAsync({
        payload: buildFieldAccessRuleUpdatePayload(draft, catalog, {
          backgroundColor: selectedRule?.rule?.backgroundColor ?? null,
          textColor: selectedRule?.rule?.textColor ?? null,
        }),
        stateCode: draft.stateCode,
      });

      await onRulesRefresh();
      toast.success("Los permisos se guardaron correctamente.", {
        duration: 2500,
        icon: <CircleCheckBig className="size-5" />,
      });
    } catch (error) {
      const message = getFieldAccessAdminErrorMessage(error);

      if (
        error instanceof ApiError &&
        error.message === "FIELD_ACCESS_RULE_VERSION_CONFLICT"
      ) {
        setVersionConflictMessage(message);
      }

      toast.error(message, {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
      });
    }
  }

  async function handleReloadAfterConflict() {
    clearDerivedState();
    await onRulesRefresh();
  }

  if (isRuleLoading) {
    return (
      <section className="rounded-md border border-border p-4">
        <p className="text-sm text-foreground-secondary">
          Cargando configuración...
        </p>
      </section>
    );
  }

  if (!draft || !selectedRule) {
    return (
      <section className="rounded-md border border-border p-4">
        <p className="text-sm text-foreground-secondary">
          Selecciona un estado para revisar o editar sus permisos de edición.
        </p>
      </section>
    );
  }

  const invalidFields = draft.editableFields.filter(
    (field) =>
      !flattenFieldCatalog(catalog).includes(field) ||
      blockedFields.includes(field),
  );
  const invalidGroups = draft.editableGroups.filter(
    (group) => !catalog.groupCatalog.includes(group),
  );
  const canSubmit = validationIssues.length === 0 && !updateMutation.isPending;
  const sourceStatus = getFieldAccessSourceStatus(selectedRule.source);
  const activeStatus = getFieldAccessActiveStatus(draft.active);
  const enabledFieldCount = draft.editableFields.length;

  return (
    <section className="mx-auto flex w-full max-w-[1360px] flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button onClick={onBack} type="button" variant="ghost">
          <ArrowLeft className="mr-2 size-4" />
          Volver al listado
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-surface shadow-sm">
        <header className="space-y-5 border-b border-border bg-muted/15 px-5 py-5 md:px-6 md:py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl space-y-3">
              <div className="inline-flex rounded-full border border-border bg-background px-3 py-1 text-[11px] font-medium tracking-[0.12em] text-foreground-secondary uppercase">
                Permisos de edición por estado
              </div>
              <div className="space-y-2">
                <h2 className="text-[1.7rem] leading-tight font-semibold text-foreground">
                  Editar permisos de {selectedRule.state.name}
                </h2>
                <p className="text-sm leading-6 text-foreground-secondary">
                  Definí qué datos se pueden editar mientras la solicitud esté
                  en este estado.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getBadgeClasses(sourceStatus.tone)}`}
              >
                Configuración: {sourceStatus.label}
              </span>
              <span
                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getBadgeClasses(activeStatus.tone)}`}
              >
                Regla: {activeStatus.label}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-border/80 bg-background/80 p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-sm text-foreground-secondary">
                  <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-2.5 py-1">
                    <ListChecks className="size-3.5" />
                    Estado: {selectedRule.state.name}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-2.5 py-1">
                    <Layers3 className="size-3.5" />
                    Área responsable: {selectedRule.state.ownerName}
                  </span>
                </div>
                <p className="text-sm leading-6 text-foreground-secondary">
                  Estos cambios afectan cómo se edita la solicitud cuando entra
                  en este estado.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <SummaryMetric
                  icon={ShieldCheck}
                  label="Regla"
                  tone={activeStatus.tone}
                  value={activeStatus.label}
                />
                <SummaryMetric
                  icon={Eye}
                  label="Campos habilitados"
                  value={String(enabledFieldCount)}
                />
              </div>
            </div>
          </div>

          <EditorTabs
            activeTab={activeTab}
            onTabChange={(tab) =>
              setTabState({
                stateCode: selectedRule.state.code,
                tab,
              })
            }
          />
        </header>

        <div className="space-y-5 px-5 py-5 pb-28 md:px-6 md:py-6">
          {versionConflictMessage ? (
            <FieldAccessVersionConflictAlert
              message={versionConflictMessage}
              onReload={handleReloadAfterConflict}
            />
          ) : null}

          {validationIssues.length > 0 ? (
            <section className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <h3 className="text-sm font-semibold text-destructive">
                Hay elementos para revisar antes de guardar
              </h3>
              <p className="text-sm text-foreground">
                La configuración tiene problemas y no se puede guardar hasta
                corregirlos.
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                {validationIssues.map((issue) => (
                  <li key={`${issue.code}:${issue.value}`}>{issue.message}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {invalidGroups.length > 0 ? (
            <section className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <h3 className="text-sm font-semibold text-destructive">
                Hay secciones legacy de esta configuración que ya no se pueden
                usar
              </h3>
              <div className="space-y-2">
                <p className="text-sm text-foreground">
                  Puedes quitarlas para normalizar la regla sin volver a mostrar
                  secciones completas en la UI.
                </p>
                <div className="flex flex-wrap gap-2">
                  {invalidGroups.map((group) => (
                    <Button
                      key={group}
                      onClick={() =>
                        updateDraft((current) => ({
                          ...current,
                          editableGroups: removeDraftValue(
                            current.editableGroups,
                            group,
                          ),
                        }))
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Quitar {getFieldAccessGroupLabel(group)}
                    </Button>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          <EditorTabPanel activeTab={activeTab} tab="general">
            <section className="space-y-5 rounded-2xl border border-border bg-background/70 p-5">
              <header className="max-w-3xl space-y-2">
                <h3 className="text-base font-semibold text-foreground">
                  Cómo se comporta este estado
                </h3>
                <p className="text-sm leading-6 text-foreground-secondary">
                  Configura si esta regla se aplica y qué verá el usuario cuando
                  la solicitud no pueda editarse.
                </p>
              </header>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="space-y-4">
                  <section className="rounded-xl border border-border bg-background p-4">
                    <div className="flex items-start gap-3">
                      <div className="rounded-full border border-border bg-muted/35 p-2">
                        <CheckCircle2 className="size-4 text-foreground-secondary" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="space-y-1">
                          <h4 className="text-sm font-semibold text-foreground">
                            Activación de la regla
                          </h4>
                          <p className="text-sm leading-6 text-foreground-secondary">
                            Define si esta configuración se usa cuando la
                            solicitud llega a este estado.
                          </p>
                        </div>

                        <label className="flex items-start gap-3 rounded-xl border border-border bg-muted/15 px-3 py-3 text-sm text-foreground">
                          <Checkbox
                            checked={draft.active}
                            onCheckedChange={(checked) =>
                              updateDraft((current) => ({
                                ...current,
                                active: checked === true,
                              }))
                            }
                          />
                          <span className="space-y-1">
                            <span className="block font-medium">
                              Usar esta configuración en este estado
                            </span>
                            <span className="block text-xs leading-5 text-foreground-secondary">
                              Si está activa, esta regla define qué datos se
                              pueden editar cuando la solicitud llegue a este
                              estado.
                            </span>
                          </span>
                        </label>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-xl border border-border bg-background p-4">
                    <div className="flex items-start gap-3">
                      <div className="rounded-full border border-border bg-muted/35 p-2">
                        <Eye className="size-4 text-foreground-secondary" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-sm font-semibold text-foreground">
                          Si no habilitas ningún dato
                        </h4>
                        <p className="text-sm leading-6 text-foreground-secondary">
                          La solicitud quedará sin edición disponible mientras
                          permanezca en este estado.
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="hidden rounded-xl border border-border bg-background p-4">
                    <div className="mb-3 flex items-start gap-3">
                      <div className="rounded-full border border-border bg-muted/35 p-2">
                        <Layers3 className="size-4 text-foreground-secondary" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="hidden text-sm font-semibold text-foreground">
                          Apariencia de campos no editables
                        </h4>
                        <p className="text-sm leading-6 text-foreground-secondary">
                          Configura el color que verá el usuario en los campos
                          bloqueados por este estado.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <label className="space-y-2 text-sm text-foreground">
                        <span className="font-medium">Background color</span>
                        <input
                          className="flex h-9 w-full min-w-0 rounded-md border border-input-border bg-input-background px-3 py-1 text-sm text-foreground shadow-xs transition outline-none placeholder:text-foreground-muted focus-visible:border-input-focus focus-visible:ring-2 focus-visible:ring-input-focus/20"
                          onChange={(event) =>
                            updateDraft((current) => ({
                              ...current,
                              backgroundColor: event.target.value.toUpperCase(),
                            }))
                          }
                          placeholder="#FF7F7F"
                          value={draft.backgroundColor}
                        />
                      </label>

                      <label className="space-y-2 text-sm text-foreground">
                        <span className="font-medium">Text color</span>
                        <input
                          className="flex h-9 w-full min-w-0 rounded-md border border-input-border bg-input-background px-3 py-1 text-sm text-foreground shadow-xs transition outline-none placeholder:text-foreground-muted focus-visible:border-input-focus focus-visible:ring-2 focus-visible:ring-input-focus/20"
                          onChange={(event) =>
                            updateDraft((current) => ({
                              ...current,
                              textColor: event.target.value.toUpperCase(),
                            }))
                          }
                          placeholder="#000000"
                          value={draft.textColor}
                        />
                      </label>
                    </div>

                    <div className="mt-4 rounded-xl border border-border bg-muted/15 p-4">
                      <p className="text-xs font-medium tracking-[0.12em] text-foreground-secondary uppercase">
                        Vista previa
                      </p>
                      <div
                        className="mt-3 min-h-10 rounded-md border border-input-border px-3 py-2 text-sm"
                        style={{
                          backgroundColor:
                            draft.backgroundColor.trim() || undefined,
                          color: draft.textColor.trim() || undefined,
                        }}
                      >
                        Campo no editable en este estado
                      </div>
                    </div>
                  </section>
                </div>

                <aside className="rounded-xl border border-border bg-muted/15 p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-full border border-border bg-background p-2">
                      <ShieldCheck className="size-4 text-foreground-secondary" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">
                        Resultado esperado
                      </p>
                      <p className="text-sm leading-6 text-foreground-secondary">
                        Al guardar, quedarán disponibles solo los datos que
                        marques como editables para este estado.
                      </p>
                    </div>
                  </div>
                </aside>
              </div>

              <section className="rounded-xl border border-border bg-background p-4">
                <div className="mb-3 flex items-start gap-3">
                  <div className="rounded-full border border-border bg-muted/35 p-2">
                    <FileText className="size-4 text-foreground-secondary" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold text-foreground">
                      Mensaje para mostrar cuando no se pueda editar
                    </h4>
                    <p className="text-sm leading-6 text-foreground-secondary">
                      Este texto se mostrará al usuario para explicar por qué la
                      solicitud no puede editarse en este estado.
                    </p>
                  </div>
                </div>

                <label className="space-y-2 text-sm text-foreground">
                  <span className="font-medium">
                    Mensaje visible para el usuario
                  </span>
                  <textarea
                    className="min-h-28 w-full rounded-md border border-input-border bg-input-background px-3 py-2 text-sm text-foreground outline-none transition focus-visible:border-input-focus focus-visible:ring-2 focus-visible:ring-input-focus/20"
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        readonlyReason: event.target.value,
                      }))
                    }
                    placeholder={catalog.defaultReadonlyReason}
                    value={draft.readonlyReason}
                  />
                  <span className="block text-xs leading-5 text-foreground-secondary">
                    Si lo dejas vacío, se usará el mensaje por defecto definido
                    para este tipo de bloqueo.
                  </span>
                </label>
              </section>
            </section>
          </EditorTabPanel>

          <EditorTabPanel activeTab={activeTab} tab="fields">
            <section className="space-y-4 rounded-xl border border-border bg-background/70 p-4">
              <header className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    Campos editables
                  </h3>
                  <span className="inline-flex rounded-full border border-border bg-muted/35 px-2 py-0.5 text-[11px] font-medium text-foreground-secondary">
                    {enabledFieldCount} campos
                  </span>
                </div>
                <p className="text-xs text-foreground-secondary">
                  Selecciona los datos que se podrán editar dentro de este
                  estado.
                </p>
              </header>

              <SubsectionTabs<FieldsSubtab>
                activeTab={activeFieldsTab}
                onTabChange={(tab) =>
                  setFieldsTabState({
                    stateCode: selectedRule.state.code,
                    tab,
                  })
                }
                tabs={FIELDS_SUBTABS}
              />

              {invalidFields.length > 0 ? (
                <section className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                  <h3 className="text-sm font-semibold text-destructive">
                    Hay datos de esta configuración que ya no se pueden usar
                  </h3>
                  <div className="space-y-2">
                    <p className="text-sm text-foreground">
                      Datos a revisar o quitar:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {invalidFields.map((field) => (
                        <Button
                          key={field}
                          onClick={() =>
                            updateDraft((current) => ({
                              ...current,
                              editableFields: removeDraftValue(
                                current.editableFields,
                                field,
                              ),
                            }))
                          }
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Quitar {getFieldAccessFieldLabel(field)}
                        </Button>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}

              {activeFieldsTab === "solicitud" ? (
                <FieldAccessFieldGroupSection
                  fields={catalog.fieldCatalog.solicitud}
                  onToggleAllFields={applySectionSelection}
                  onToggleField={(fieldKey) =>
                    updateDraft((current) => ({
                      ...current,
                      editableFields: toggleDraftValue(
                        current.editableFields,
                        fieldKey,
                      ),
                    }))
                  }
                  selectedFields={draft.editableFields}
                  title="solicitud"
                />
              ) : null}
              {activeFieldsTab === "titular" ? (
                <FieldAccessFieldGroupSection
                  fields={catalog.fieldCatalog.titular}
                  onToggleAllFields={applySectionSelection}
                  onToggleField={(fieldKey) =>
                    updateDraft((current) => ({
                      ...current,
                      editableFields: toggleDraftValue(
                        current.editableFields,
                        fieldKey,
                      ),
                    }))
                  }
                  selectedFields={draft.editableFields}
                  title="titular"
                />
              ) : null}
              {activeFieldsTab === "conyuge" ? (
                <FieldAccessFieldGroupSection
                  fields={catalog.fieldCatalog.conyuge}
                  onToggleAllFields={applySectionSelection}
                  onToggleField={(fieldKey) =>
                    updateDraft((current) => ({
                      ...current,
                      editableFields: toggleDraftValue(
                        current.editableFields,
                        fieldKey,
                      ),
                    }))
                  }
                  selectedFields={draft.editableFields}
                  title="conyuge"
                />
              ) : null}
              {activeFieldsTab === "datosLaborales" ? (
                <FieldAccessFieldGroupSection
                  fields={catalog.fieldCatalog.datosLaborales}
                  onToggleAllFields={applySectionSelection}
                  onToggleField={(fieldKey) =>
                    updateDraft((current) => ({
                      ...current,
                      editableFields: toggleDraftValue(
                        current.editableFields,
                        fieldKey,
                      ),
                    }))
                  }
                  selectedFields={draft.editableFields}
                  title="datosLaborales"
                />
              ) : null}
              {activeFieldsTab === "garantias" ? (
                <FieldAccessFieldGroupSection
                  fields={catalog.fieldCatalog.garantias}
                  onToggleAllFields={applySectionSelection}
                  onToggleField={(fieldKey) =>
                    updateDraft((current) => ({
                      ...current,
                      editableFields: toggleDraftValue(
                        current.editableFields,
                        fieldKey,
                      ),
                    }))
                  }
                  selectedFields={draft.editableFields}
                  title="garantias"
                />
              ) : null}
              {activeFieldsTab === "adjuntos" ? (
                <section className="rounded-xl border border-border bg-background/70 p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-full border border-border bg-muted/35 p-2">
                      <FileText className="size-4 text-foreground-secondary" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-foreground">
                          Gestión de adjuntos
                        </h3>
                        <p className="text-sm leading-6 text-foreground-secondary">
                          Configurá si el área responsable de este estado puede
                          subir y eliminar adjuntos.
                        </p>
                      </div>

                      <label className="flex items-start gap-3 rounded-xl border border-border bg-muted/15 px-3 py-3 text-sm text-foreground">
                        <Checkbox
                          checked={draft.canManageAttachments}
                          onCheckedChange={(checked) =>
                            updateDraft((current) => ({
                              ...current,
                              canManageAttachments: checked === true,
                            }))
                          }
                        />
                        <span className="space-y-1">
                          <span className="block font-medium">
                            Permitir subir y eliminar adjuntos
                          </span>
                          <span className="block text-xs leading-5 text-foreground-secondary">
                            Disponible únicamente para usuarios pertenecientes
                            al owner actual del estado y mientras la regla esté
                            activa. La descarga no se modifica.
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>
                </section>
              ) : null}
            </section>
          </EditorTabPanel>

          <EditorTabPanel activeTab={activeTab} tab="protected">
            <section className="space-y-3 rounded-xl border border-border bg-background/70 p-4">
              <header className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">
                  Datos protegidos
                </h3>
                <p className="text-xs text-foreground-secondary">
                  Estos datos nunca se pueden habilitar desde esta pantalla.
                </p>
              </header>
              <div className="flex flex-wrap gap-2">
                {blockedFields.map((field) => (
                  <span
                    className="rounded-full border border-border bg-background px-2 py-1 text-xs text-foreground-secondary"
                    key={field}
                  >
                    {getFieldAccessFieldLabel(field)}
                  </span>
                ))}
              </div>
            </section>
          </EditorTabPanel>

          <EditorTabPanel activeTab={activeTab} tab="appearance">
            <section className="space-y-4 rounded-xl border border-border bg-background/70 p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-full border border-border bg-muted/35 p-2">
                  <Layers3 className="size-4 text-foreground-secondary" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">
                    Apariencia de campos no editables
                  </h3>
                  <p className="hidden text-sm leading-6 text-foreground-secondary">
                    Configura el color que verá el usuario en los campos
                    bloqueados por este estado y en la fila de los listados.
                    Debes informar ambos colores o dejar ambos vacíos.
                  </p>
                  <p className="text-sm leading-6 text-foreground-secondary">
                    Elegí cómo se verán los campos bloqueados y las filas de los
                    listados. Podés usar el selector visual o ingresar un código
                    de color de forma avanzada. Debes definir ambos colores o
                    dejar ambos vacíos.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <ColorPickerField
                    fallbackColor={DEFAULT_BACKGROUND_PREVIEW}
                    label="Color de fondo"
                    onChange={(value) =>
                      updateDraft((current) => ({
                        ...current,
                        backgroundColor: value ?? "",
                      }))
                    }
                    presets={BACKGROUND_COLOR_PRESETS}
                    value={backgroundColorValue}
                  />
                  <div className="flex justify-end">
                    <Button
                      disabled={!hasBackgroundColor}
                      onClick={() =>
                        updateDraft((current) => ({
                          ...current,
                          backgroundColor: "",
                        }))
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Quitar fondo
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <ColorPickerField
                    fallbackColor={DEFAULT_TEXT_PREVIEW}
                    label="Color de texto"
                    onChange={(value) =>
                      updateDraft((current) => ({
                        ...current,
                        textColor: value ?? "",
                      }))
                    }
                    presets={TEXT_COLOR_PRESETS}
                    value={textColorValue}
                  />
                  <div className="flex justify-end">
                    <Button
                      disabled={!hasTextColor}
                      onClick={() =>
                        updateDraft((current) => ({
                          ...current,
                          textColor: "",
                        }))
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Quitar texto
                    </Button>
                  </div>
                </div>
              </div>

              <div className="hidden grid gap-4 lg:grid-cols-2">
                <label className="space-y-2 text-sm text-foreground">
                  <span className="font-medium">Color de fondo</span>
                  <input
                    className="flex h-9 w-full min-w-0 rounded-md border border-input-border bg-input-background px-3 py-1 text-sm text-foreground shadow-xs transition outline-none placeholder:text-foreground-muted focus-visible:border-input-focus focus-visible:ring-2 focus-visible:ring-input-focus/20"
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        backgroundColor: event.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="#FF7F7F"
                    value={draft.backgroundColor}
                  />
                </label>

                <label className="space-y-2 text-sm text-foreground">
                  <span className="font-medium">Color de texto</span>
                  <input
                    className="flex h-9 w-full min-w-0 rounded-md border border-input-border bg-input-background px-3 py-1 text-sm text-foreground shadow-xs transition outline-none placeholder:text-foreground-muted focus-visible:border-input-focus focus-visible:ring-2 focus-visible:ring-input-focus/20"
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        textColor: event.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="#000000"
                    value={draft.textColor}
                  />
                </label>
              </div>

              <div className="flex justify-end">
                <Button
                  disabled={!hasBackgroundColor && !hasTextColor}
                  onClick={() =>
                    updateDraft((current) => ({
                      ...current,
                      backgroundColor: "",
                      textColor: "",
                    }))
                  }
                  type="button"
                  variant="outline"
                >
                  Quitar colores personalizados
                </Button>
              </div>

              <div className="rounded-xl border border-border bg-muted/15 p-4">
                <p className="text-xs font-medium tracking-[0.12em] text-foreground-secondary uppercase">
                  Vista previa
                </p>
                <div
                  className="mt-3 min-h-10 rounded-md border border-input-border px-3 py-2 text-sm"
                  style={{
                    backgroundColor:
                      backgroundColorValue ?? DEFAULT_BACKGROUND_PREVIEW,
                    color: textColorValue ?? DEFAULT_TEXT_PREVIEW,
                  }}
                >
                  Campo no editable en este estado
                </div>
              </div>

              <div className="hidden mt-4 rounded-xl border border-border bg-muted/15 p-4">
                <p className="text-xs font-medium tracking-[0.12em] text-foreground-secondary uppercase">
                  Vista previa
                </p>
                <div
                  className="mt-3 min-h-10 rounded-md border border-input-border px-3 py-2 text-sm"
                  style={{
                    backgroundColor: draft.backgroundColor.trim() || undefined,
                    color: draft.textColor.trim() || undefined,
                  }}
                >
                  Campo no editable en este estado
                </div>
              </div>
            </section>
          </EditorTabPanel>
        </div>

        <footer className="sticky bottom-0 border-t border-border bg-surface/95 px-5 py-3.5 backdrop-blur md:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {canSubmit
                  ? "Los cambios están listos para guardarse."
                  : "Revisa los puntos pendientes antes de guardar."}
              </p>
              <p className="text-xs text-foreground-secondary">
                Los cambios se aplicarán a las solicitudes que entren en este
                estado.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button onClick={onBack} type="button" variant="ghost">
                Cancelar
              </Button>
              <Button disabled={!canSubmit} onClick={handleSave} type="button">
                {updateMutation.isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
            </div>
          </div>
        </footer>
      </div>
    </section>
  );
}

function SummaryMetric({
  icon: Icon,
  label,
  tone = "neutral",
  value,
}: {
  icon: typeof CheckCircle2;
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  value: string;
}) {
  const toneClasses =
    tone === "warning"
      ? "border-amber-200/80 bg-amber-50/80"
      : tone === "danger"
        ? "border-destructive/20 bg-destructive/5"
        : "border-border bg-background";
  const iconClasses =
    tone === "success"
      ? "border-emerald-200/80 bg-emerald-100/80 text-emerald-700 dark:text-emerald-300"
      : tone === "warning"
        ? "border-amber-200/80 bg-amber-100/80 text-amber-700 dark:text-amber-300"
        : tone === "danger"
          ? "border-destructive/20 bg-destructive/10 text-destructive"
          : "border-border bg-muted/25 text-foreground-secondary";
  const valueClasses =
    tone === "warning"
      ? "text-amber-800 dark:text-amber-200"
      : tone === "danger"
        ? "text-destructive"
        : "text-foreground";

  return (
    <div className={`rounded-xl border px-3 py-3 ${toneClasses}`}>
      <div className="flex items-start gap-3">
        <div className={`rounded-full border p-2 ${iconClasses}`}>
          <Icon className="size-3.5" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-medium tracking-[0.12em] text-foreground-secondary uppercase">
            {label}
          </p>
          <p className={`truncate text-sm font-semibold ${valueClasses}`}>
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function EditorTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: EditorTab;
  onTabChange: (tab: EditorTab) => void;
}) {
  return (
    <div
      aria-label="Secciones de configuración"
      className="-mx-4 -mb-5 overflow-x-auto border-t border-border/70 px-4 pt-4 md:-mx-5 md:px-5"
      role="tablist"
    >
      <div className="flex min-w-max gap-2">
        {EDITOR_TABS.map((tab) => {
          const isActive = tab.value === activeTab;

          return (
            <button
              aria-controls={`field-access-tabpanel-${tab.value}`}
              aria-selected={isActive}
              className={`rounded-t-lg border border-b-0 px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-focus/20 ${
                isActive
                  ? "border-border bg-surface text-foreground shadow-sm"
                  : "border-transparent bg-transparent text-foreground-secondary hover:border-border/60 hover:bg-background/70 hover:text-foreground"
              }`}
              id={`field-access-tab-${tab.value}`}
              key={tab.value}
              onClick={() => onTabChange(tab.value)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EditorTabPanel({
  activeTab,
  children,
  tab,
}: {
  activeTab: EditorTab;
  children: ReactNode;
  tab: EditorTab;
}) {
  const isActive = activeTab === tab;

  return (
    <div
      aria-labelledby={`field-access-tab-${tab}`}
      hidden={!isActive}
      id={`field-access-tabpanel-${tab}`}
      role="tabpanel"
      tabIndex={0}
    >
      {children}
    </div>
  );
}

type ColorPickerFieldProps = {
  ariaDescribedBy?: string;
  fallbackColor: string;
  label: string;
  onChange: (value: string | null) => void;
  presets: ReadonlyArray<{
    name: string;
    value: string;
  }>;
  value: string | null;
};

function ColorPickerField({
  ariaDescribedBy,
  fallbackColor,
  label,
  onChange,
  presets,
  value,
}: ColorPickerFieldProps) {
  const effectiveColor = value ?? fallbackColor;
  const selectedPreset = presets.find((preset) => preset.value === value);
  const triggerLabel = value
    ? (selectedPreset?.name ?? "Color personalizado")
    : "Sin color personalizado";

  function handlePickerChange(nextColor: ColorResult) {
    const normalized = normalizeHexColor(nextColor.hex);

    if (!normalized) {
      return;
    }

    onChange(normalized);
  }

  return (
    <div className="space-y-2 text-sm text-foreground">
      <label className="block font-medium">{label}</label>
      <PopoverRoot>
        <PopoverTrigger asChild>
          <Button
            aria-describedby={ariaDescribedBy}
            className="h-auto w-full justify-between rounded-xl px-3 py-3"
            type="button"
            variant="outline"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="size-6 shrink-0 rounded-md border border-border shadow-xs"
                style={{ backgroundColor: effectiveColor }}
              />
              <span className="min-w-0 text-left">
                <span className="block truncate font-medium">
                  {triggerLabel}
                </span>
                <span className="block truncate text-xs text-foreground-secondary">
                  Abrir selector visual
                </span>
              </span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-foreground-secondary" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className={COLOR_PICKER_POPOVER_CLASS_NAME}
          side="bottom"
          sideOffset={COLOR_PICKER_POPOVER_SIDE_OFFSET}
        >
          <div
            aria-label={label}
            className="w-full min-w-0 box-border [&_.hue-horizontal]:!rounded-md [&_.hue-horizontal]:!px-0 [&_.hue-horizontal>div]:!top-1/2 [&_.hue-horizontal>div>div]:!h-4 [&_.hue-horizontal>div>div]:!w-4 [&_.hue-horizontal>div>div]:!rounded-full [&_.hue-horizontal>div>div]:!border-2 [&_.hue-horizontal>div>div]:!border-white [&_.hue-horizontal>div>div]:!bg-white [&_.hue-horizontal>div>div]:!shadow-[0_0_0_1px_rgba(15,23,42,0.12),0_1px_4px_rgba(15,23,42,0.28)] [&_.hue-horizontal>div>div]:![transform:translate(-50%,-50%)] [&_.sketch-picker]:!w-full [&_.sketch-picker]:!rounded-lg [&_.sketch-picker]:!bg-background [&_.sketch-picker]:!shadow-none [&_.sketch-picker]:font-sans [&_.sketch-picker_input]:!text-foreground [&_.sketch-picker_input]:!shadow-none [&_.sketch-picker_label]:!text-foreground-secondary [&_.sketch-picker_span]:!text-foreground-secondary"
          >
            <SketchPicker
              color={effectiveColor}
              disableAlpha
              onChange={handlePickerChange}
              presetColors={presets.map((preset) => preset.value)}
              styles={{
                default: {
                  picker: {
                    background: "var(--background)",
                    boxSizing: "border-box",
                    borderRadius: "0.75rem",
                    padding: "10px",
                    boxShadow: "none",
                    width: "100%",
                  },
                  saturation: {
                    paddingBottom: "80%",
                  },
                  hue: {
                    height: "13px",
                    overflow: "visible",
                  },
                },
              }}
            />
          </div>
        </PopoverContent>
      </PopoverRoot>
    </div>
  );
}

function flattenFieldCatalog(catalog: FieldAccessFieldsResponse) {
  return [
    ...catalog.fieldCatalog.solicitud,
    ...catalog.fieldCatalog.titular,
    ...catalog.fieldCatalog.conyuge,
    ...catalog.fieldCatalog.datosLaborales,
    ...catalog.fieldCatalog.garantias,
  ];
}

function normalizeOptionalDraftColor(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : null;
}

function normalizeManualInputValue(value: string) {
  const trimmed = value.trim().toUpperCase();

  if (trimmed.length === 0) {
    return "";
  }

  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function normalizeHexColor(value: string) {
  const normalized = normalizeManualInputValue(value);
  return HEX_COLOR_PATTERN.test(normalized) ? normalized : null;
}
