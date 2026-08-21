import type * as React from "react";

import { CircleAlert } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from "@/shared/components/ui/dialog";

export type ConfirmDialogProps = {
  cancelLabel?: string;
  confirmLabel?: string;
  description: string;
  isConfirming?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  progress?: React.ReactNode;
  title: string;
  variant?: "default" | "destructive";
};

export function ConfirmDialog({
  cancelLabel = "Cancelar",
  confirmLabel = "Confirmar",
  description,
  isConfirming = false,
  onConfirm,
  onOpenChange,
  open,
  progress,
  title,
  variant = "default",
}: ConfirmDialogProps) {
  return (
    <DialogRoot
      onOpenChange={(nextOpen) => {
        if (isConfirming) {
          return;
        }

        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent
        className="max-w-md p-6"
        onEscapeKeyDown={(event) => {
          if (isConfirming) {
            event.preventDefault();
          }
        }}
        onPointerDownOutside={(event) => {
          if (isConfirming) {
            event.preventDefault();
          }
        }}
      >
        <div className="flex items-start gap-3">
          {variant === "destructive" ? (
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <CircleAlert className="size-5" />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <DialogTitle className="text-base font-semibold text-foreground">
              {title}
            </DialogTitle>
            <DialogDescription className="text-sm text-foreground-secondary">
              {description}
            </DialogDescription>
          </div>
        </div>

        {isConfirming && progress ? (
          <div className="mt-4">{progress}</div>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button
            disabled={isConfirming}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            {cancelLabel}
          </Button>
          <Button
            disabled={isConfirming}
            onClick={onConfirm}
            type="button"
            variant={variant === "destructive" ? "destructive" : "default"}
          >
            {isConfirming ? "Procesando..." : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
