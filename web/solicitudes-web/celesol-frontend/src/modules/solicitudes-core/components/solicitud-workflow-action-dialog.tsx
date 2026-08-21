import { Send, X } from "lucide-react";
import { useState } from "react";

import type {
  ExecuteWorkflowTransitionRequest,
  WorkflowTransition,
} from "@/modules/solicitudes/types/solicitudes-core";
import { Button } from "@/shared/components/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from "@/shared/components/ui/dialog";

type SolicitudWorkflowActionDialogProps = {
  errorMessage?: string | null;
  isSubmitting?: boolean;
  onConfirm: (
    payload: ExecuteWorkflowTransitionRequest,
  ) => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  transition: WorkflowTransition | null;
  validate?: (payload: ExecuteWorkflowTransitionRequest) => string | null;
};

export function SolicitudWorkflowActionDialog({
  errorMessage,
  isSubmitting = false,
  onConfirm,
  onOpenChange,
  open,
  transition,
  validate,
}: SolicitudWorkflowActionDialogProps) {
  const [comment, setComment] = useState("");
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );
  const trimmedComment = comment.trim();
  const isCommentMissing =
    transition?.requiresComment === true && trimmedComment.length === 0;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setComment("");
      setValidationMessage(null);
    }

    onOpenChange(nextOpen);
  }

  async function handleConfirm() {
    if (!transition) {
      return;
    }

    if (isCommentMissing) {
      setValidationMessage("Ingresa un comentario para confirmar la acción.");
      return;
    }

    const payload = {
      actionCode: transition.actionCode,
      ...(trimmedComment ? { comment: trimmedComment } : {}),
    };
    const customValidationMessage = validate?.(payload) ?? null;

    if (customValidationMessage) {
      setValidationMessage(customValidationMessage);
      return;
    }

    setValidationMessage(null);
    await onConfirm(payload);
  }

  return (
    <DialogRoot onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] max-w-[560px] flex-col overflow-hidden p-0">
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-background text-foreground-secondary">
              <Send className="size-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-xl font-semibold leading-tight text-foreground">
                {transition?.actionLabel ?? "Confirmar acción"}
              </DialogTitle>
              {transition?.toState ? (
                <DialogDescription className="mt-1 text-sm text-foreground-secondary">
                  Destino: {transition.toState.name}
                </DialogDescription>
              ) : null}
            </div>
          </div>
          <DialogClose asChild>
            <Button
              className="text-foreground-secondary"
              disabled={isSubmitting}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X className="size-4" />
            </Button>
          </DialogClose>
        </header>

        <div className="space-y-4 px-4 py-4">
          {transition?.description ? (
            <p className="text-sm text-foreground-secondary">
              {transition.description}
            </p>
          ) : null}

          {transition?.defaultComment ? (
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-3">
              <p className="text-xs font-medium tracking-[0.12em] text-foreground-secondary uppercase">
                Comentario automático
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                {transition.defaultComment}
              </p>
            </div>
          ) : null}

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground-secondary">
              Comentario{transition?.requiresComment ? " *" : ""}
            </span>
            <textarea
              className="flex min-h-24 w-full min-w-0 resize-none rounded-md border border-input-border bg-input-background px-3 py-2 text-sm text-foreground shadow-xs transition outline-none placeholder:text-foreground-muted focus-visible:border-input-focus focus-visible:ring-2 focus-visible:ring-input-focus/20 disabled:cursor-not-allowed disabled:bg-disabled-background disabled:text-disabled-foreground"
              disabled={isSubmitting}
              onChange={(event) => {
                setComment(event.target.value);
                if (validationMessage) {
                  setValidationMessage(null);
                }
              }}
              value={comment}
            />
          </label>

          {validationMessage || errorMessage ? (
            <p className="rounded-md border border-danger bg-danger px-3 py-2 text-sm text-danger-foreground">
              {validationMessage ?? errorMessage}
            </p>
          ) : null}
        </div>

        <footer className="shrink-0 border-t border-border bg-surface px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            <DialogClose asChild>
              <Button disabled={isSubmitting} type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button
              disabled={!transition || isSubmitting || isCommentMissing}
              onClick={() => void handleConfirm()}
              type="button"
            >
              {isSubmitting ? "Ejecutando..." : "Confirmar"}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </DialogRoot>
  );
}
