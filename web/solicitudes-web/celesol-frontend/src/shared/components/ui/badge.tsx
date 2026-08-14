import type { ReactNode } from "react";

import { cn } from "@/shared/utils/cn";

const BADGE_VARIANT_CLASSES = {
  success: "border-success/50 bg-success/20 text-success-foreground",
  warning: "border-warning/50 bg-warning/20 text-warning-foreground",
  danger: "border-danger/50 bg-danger/20 text-danger-foreground",
  neutral: "border-input-border bg-background text-foreground-secondary",
} as const;

const BADGE_DOT_CLASSES = {
  success: "bg-success-foreground",
  warning: "bg-warning-foreground",
  danger: "bg-danger-foreground",
  neutral: "bg-foreground-muted",
} as const;

type BadgeVariant = keyof typeof BADGE_VARIANT_CLASSES;

function Badge({
  children,
  className,
  dot = false,
  icon,
  variant = "neutral",
}: {
  children: ReactNode;
  className?: string;
  dot?: boolean;
  icon?: ReactNode;
  variant?: BadgeVariant;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
        BADGE_VARIANT_CLASSES[variant],
        className,
      )}
    >
      {dot ? (
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            BADGE_DOT_CLASSES[variant],
          )}
        />
      ) : null}
      {icon}
      {children}
    </span>
  );
}

export { Badge };
export type { BadgeVariant };
