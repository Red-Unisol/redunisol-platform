import { AlertTriangle } from "lucide-react";

import { Button } from "@/shared/components/ui/button";

type FieldAccessVersionConflictAlertProps = {
  message: string;
  onReload: () => void;
};

export function FieldAccessVersionConflictAlert({
  message,
  onReload,
}: FieldAccessVersionConflictAlertProps) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 text-destructive" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium text-destructive">
            Esta configuración cambió mientras la estabas editando
          </p>
          <p className="text-sm leading-6 text-foreground">{message}</p>
          <Button onClick={onReload} size="sm" type="button" variant="outline">
            Recargar configuración
          </Button>
        </div>
      </div>
    </div>
  );
}
