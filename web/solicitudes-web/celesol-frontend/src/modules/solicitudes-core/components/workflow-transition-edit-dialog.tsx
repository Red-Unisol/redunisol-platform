import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowRightLeft,
  CircleCheckBig,
  CircleDot,
  Flag,
  MessageSquareText,
} from "lucide-react";
import { toast } from "sonner";

import { ModalField } from "@/modules/solicitudes-editor/components/fields/base";
import { useWorkflowTransitionRuleUpdateMutation } from "@/modules/solicitudes-core/hooks/use-workflow-transition-rule-update-mutation";
import type {
  WorkflowTransitionAdminRecord,
  WorkflowTransitionAdminStateGroup,
} from "@/modules/solicitudes-core/services/workflow-transition-admin-api";
import {
  buildWorkflowTransitionDraft,
  buildWorkflowTransitionUpdateRequest,
  isWorkflowTransitionDraftDirty,
  type WorkflowTransitionDraft,
  validateWorkflowTransitionDraft,
} from "@/modules/solicitudes-core/utils/workflow-transition-admin-form";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { ApiError } from "@/shared/services/http/api-error";

type WorkflowTransitionRow = {
  fromState: WorkflowTransitionAdminStateGroup["fromState"];
  transition: WorkflowTransitionAdminRecord;
};

type WorkflowTransitionEditDialogProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  row: WorkflowTransitionRow | null;
};

type ReadonlyCardVariant = "origin" | "transition" | "destination";

const UPDATE_WORKFLOW_TRANSITION_SUCCESS_TOAST_ID =
  "update-workflow-transition-success";

export function WorkflowTransitionEditDialog({
  onOpenChange,
  open,
  row,
}: WorkflowTransitionEditDialogProps) {
  return (
    <DialogRoot onOpenChange={onOpenChange} open={open}>
      {row ? (
        <WorkflowTransitionEditForm
          key={`${row.transition.id}:${row.transition.updatedAt}`}
          onOpenChange={onOpenChange}
          row={row}
        />
      ) : null}
    </DialogRoot>
  );
}

function WorkflowTransitionEditForm({
  onOpenChange,
  row,
}: {
  onOpenChange: (open: boolean) => void;
  row: WorkflowTransitionRow;
}) {
  const updateMutation = useWorkflowTransitionRuleUpdateMutation();
  const [draft, setDraft] = useState<WorkflowTransitionDraft>(() =>
    buildWorkflowTransitionDraft(row.transition),
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validationMessage = useMemo(
    () => validateWorkflowTransitionDraft(draft),
    [draft],
  );
  const transitionDisplayValue = useMemo(() => {
    const actionLabel = row.transition.actionLabel.trim();
    return actionLabel.length > 0 ? actionLabel : row.transition.actionCode;
  }, [row.transition.actionCode, row.transition.actionLabel]);
  const isDirty = isWorkflowTransitionDraftDirty(draft, row.transition);
  const isSubmitting = updateMutation.isPending;
  const canSubmit = isDirty && !validationMessage && !isSubmitting;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setSubmitError(null);

    try {
      await updateMutation.mutateAsync({
        payload: buildWorkflowTransitionUpdateRequest(draft),
        transitionId: row.transition.id,
      });
      toast.success("Transición actualizada correctamente.", {
        duration: 3500,
        icon: <CircleCheckBig className="size-5" />,
        id: UPDATE_WORKFLOW_TRANSITION_SUCCESS_TOAST_ID,
      });
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setSubmitError(
          "La transición fue modificada por otro usuario. Cerrá el modal y volvé a abrirlo para trabajar sobre la versión más reciente.",
        );
        return;
      }

      if (error instanceof Error) {
        setSubmitError(error.message);
        return;
      }

      setSubmitError("No se pudo guardar la transición.");
    }
  }

  return (
    <DialogContent className="flex max-h-[calc(100vh-3rem)] max-w-[760px] flex-col overflow-hidden border-border/80 p-0">
      <div className="border-b border-border bg-muted/25 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background shadow-xs">
            <MessageSquareText className="size-4 text-foreground-secondary" />
          </div>
          <div className="min-w-0">
            <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] font-medium tracking-[0.08em] text-foreground-secondary uppercase">
              Transiciones
            </span>
            <DialogTitle className="mt-2 text-lg font-semibold text-foreground">
              Editar transición
            </DialogTitle>
            <DialogDescription className="mt-1 max-w-2xl text-sm text-foreground-secondary">
              Ajustá la metadata visible y el comentario automático sin cambiar
              el flujo real del workflow.
            </DialogDescription>
          </div>
        </div>
      </div>

      <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <section className="rounded-xl border border-border bg-background/60 p-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch">
              <ReadonlyCard
                label="Estado origen"
                secondary={row.fromState.owner.name}
                value={row.fromState.name}
                variant="origin"
              />
              <FlowArrow direction="horizontal" />
              <FlowArrow direction="vertical" />
              <ReadonlyCard
                label="Transición"
                value={transitionDisplayValue}
                variant="transition"
              />
              <FlowArrow direction="horizontal" />
              <FlowArrow direction="vertical" />
              <ReadonlyCard
                label="Estado destino"
                secondary={row.transition.toState.owner?.name}
                value={row.transition.toState.name}
                variant="destination"
              />
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <ModalField label="Nombre visible">
              <Input
                disabled={isSubmitting}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    actionLabel: event.target.value,
                  }))
                }
                value={draft.actionLabel}
              />
            </ModalField>

            <ModalField label="Orden">
              <Input
                disabled={isSubmitting}
                inputMode="numeric"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    sortOrder: event.target.value,
                  }))
                }
                value={draft.sortOrder}
              />
            </ModalField>

            <ModalField className="md:col-span-2" label="Comentario automático">
              <textarea
                className="flex min-h-28 w-full min-w-0 resize-y rounded-md border border-input-border bg-input-background px-3 py-2 text-sm text-foreground shadow-xs transition outline-none placeholder:text-foreground-muted focus-visible:border-input-focus focus-visible:ring-2 focus-visible:ring-input-focus/20 disabled:cursor-not-allowed disabled:bg-disabled-background disabled:text-disabled-foreground"
                disabled={isSubmitting}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    defaultComment: event.target.value,
                  }))
                }
                placeholder="Sin comentario automático"
                value={draft.defaultComment}
              />
            </ModalField>

            <ModalField className="md:col-span-2" label="Descripción">
              <textarea
                className="flex min-h-24 w-full min-w-0 resize-y rounded-md border border-input-border bg-input-background px-3 py-2 text-sm text-foreground shadow-xs transition outline-none placeholder:text-foreground-muted focus-visible:border-input-focus focus-visible:ring-2 focus-visible:ring-input-focus/20 disabled:cursor-not-allowed disabled:bg-disabled-background disabled:text-disabled-foreground"
                disabled={isSubmitting}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Sin descripción"
                value={draft.description}
              />
            </ModalField>

            <ModalField className="md:col-span-2" label="Requiere comentario">
              <label className="flex min-h-10 items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
                <Checkbox
                  checked={draft.requiresComment}
                  disabled={isSubmitting}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      requiresComment: checked === true,
                    }))
                  }
                />
                <span>
                  Exigir comentario manual al ejecutar esta transición
                </span>
              </label>
            </ModalField>
          </section>

          {validationMessage ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {validationMessage}
            </p>
          ) : null}

          {!validationMessage && submitError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {submitError}
            </p>
          ) : null}

          {!isDirty ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-foreground-secondary">
              <ArrowRightLeft className="size-4" />
              Sin cambios pendientes.
            </div>
          ) : null}
        </div>

        <div className="border-t border-border bg-surface px-5 py-4">
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button
                disabled={isSubmitting}
                onClick={() => onOpenChange(false)}
                type="button"
                variant="outline"
              >
                Cancelar
              </Button>
            </DialogClose>
            <Button disabled={!canSubmit} type="submit">
              {isSubmitting ? "Guardando..." : "Guardar cambios"}
            </Button>
          </div>
        </div>
      </form>
    </DialogContent>
  );
}

function ReadonlyCard({
  label,
  secondary,
  value,
  variant,
}: {
  label: string;
  secondary?: string;
  value: string;
  variant: ReadonlyCardVariant;
}) {
  const styles = getReadonlyCardStyles(variant);

  return (
    <div
      className={`min-h-28 h-auto h-full min-w-0 rounded-xl border px-4 py-3 ${styles.containerClassName}`}
    >
      <div className="flex h-full min-w-0 items-start gap-3">
        <div
          className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${styles.iconContainerClassName}`}
        >
          <styles.Icon aria-hidden="true" className="size-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p
            className={`min-w-0 whitespace-normal break-words [overflow-wrap:anywhere] text-[11px] font-semibold tracking-[0.1em] uppercase ${styles.labelClassName}`}
          >
            {label}
          </p>
          <p
            className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere] text-sm font-medium text-foreground"
            title={value}
          >
            {value}
          </p>
          {secondary ? (
            <p
              className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere] text-xs text-foreground-secondary"
              title={secondary}
            >
              {secondary}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FlowArrow({ direction }: { direction: "horizontal" | "vertical" }) {
  const isHorizontal = direction === "horizontal";
  const Icon = isHorizontal ? ArrowRight : ArrowDown;

  return (
    <div
      className={
        isHorizontal
          ? "hidden shrink-0 items-center justify-center self-center text-foreground-muted md:flex"
          : "flex shrink-0 items-center justify-center text-foreground-muted md:hidden"
      }
    >
      <Icon aria-hidden="true" className="size-[18px]" />
    </div>
  );
}

function getReadonlyCardStyles(variant: ReadonlyCardVariant) {
  switch (variant) {
    case "origin":
      return {
        containerClassName:
          "border-blue-200 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/20",
        iconContainerClassName:
          "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
        labelClassName: "text-blue-700 dark:text-blue-300",
        Icon: CircleDot,
      };
    case "transition":
      return {
        containerClassName:
          "border-violet-200 bg-violet-50/70 dark:border-violet-900 dark:bg-violet-950/20",
        iconContainerClassName:
          "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
        labelClassName: "text-violet-700 dark:text-violet-300",
        Icon: ArrowRightLeft,
      };
    case "destination":
      return {
        containerClassName:
          "border-teal-200 bg-teal-50/70 dark:border-teal-900 dark:bg-teal-950/20",
        iconContainerClassName:
          "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
        labelClassName: "text-teal-700 dark:text-teal-300",
        Icon: Flag,
      };
  }
}
