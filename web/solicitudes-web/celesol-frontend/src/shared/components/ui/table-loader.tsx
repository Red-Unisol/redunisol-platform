import { cn } from "@/shared/utils/cn";

type TableLoaderProps = {
  className?: string;
  label?: string;
};

export function TableLoader({
  className,
  label = "Cargando...",
}: TableLoaderProps) {
  return (
    <div
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-2",
        className,
      )}
      role="status"
    >
      <span
        className="size-7 animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none"
        aria-hidden="true"
      />
      <span className="text-sm text-foreground-muted">{label}</span>
    </div>
  );
}
