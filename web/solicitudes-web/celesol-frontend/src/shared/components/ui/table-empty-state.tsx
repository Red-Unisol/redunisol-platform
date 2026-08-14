import { Inbox } from "lucide-react";

type TableEmptyStateProps = {
  message?: string;
};

export function TableEmptyState({
  message = "Sin datos para mostrar",
}: TableEmptyStateProps) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center justify-center gap-3 py-4 text-center">
      <span className="flex size-11 items-center justify-center rounded-full border border-border-soft bg-muted/70 text-foreground-secondary">
        <Inbox className="size-4.5" />
      </span>
      <span className="text-sm font-medium tracking-tight text-foreground-muted">
        {message}
      </span>
    </div>
  );
}
