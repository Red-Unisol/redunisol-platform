import * as React from "react";
import { Tooltip } from "radix-ui";

import { cn } from "@/shared/utils/cn";

function TooltipProvider(props: React.ComponentProps<typeof Tooltip.Provider>) {
  return <Tooltip.Provider data-slot="tooltip-provider" {...props} />;
}

function TooltipRoot(props: React.ComponentProps<typeof Tooltip.Root>) {
  return <Tooltip.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger(props: React.ComponentProps<typeof Tooltip.Trigger>) {
  return <Tooltip.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof Tooltip.Content>) {
  return (
    <Tooltip.Portal>
      <Tooltip.Content
        className={cn(
          "z-50 max-w-64 rounded-md border border-border bg-surface px-3 py-2 text-xs text-foreground shadow-md outline-none duration-200 data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=delayed-open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1",
          className,
        )}
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        {...props}
      />
    </Tooltip.Portal>
  );
}

export { TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger };
