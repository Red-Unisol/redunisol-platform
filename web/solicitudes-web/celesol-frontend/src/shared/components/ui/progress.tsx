import * as React from "react";
import { Progress as RadixProgress } from "radix-ui";

import { cn } from "@/shared/utils/cn";

export type ProgressProps = React.ComponentProps<typeof RadixProgress.Root>;

export function Progress({ className, value, ...props }: ProgressProps) {
  const isIndeterminate = value === null || value === undefined;

  return (
    <RadixProgress.Root
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-muted",
        className,
      )}
      value={value}
      {...props}
    >
      <RadixProgress.Indicator
        className={cn(
          "h-full rounded-full bg-primary",
          isIndeterminate
            ? "w-1/3"
            : "w-full transition-transform duration-300 ease-out",
        )}
        style={{
          animation: isIndeterminate
            ? "progressIndeterminate 1.2s ease-in-out infinite"
            : undefined,
          transform: isIndeterminate
            ? undefined
            : `translateX(-${100 - (value ?? 0)}%)`,
        }}
      />
    </RadixProgress.Root>
  );
}
