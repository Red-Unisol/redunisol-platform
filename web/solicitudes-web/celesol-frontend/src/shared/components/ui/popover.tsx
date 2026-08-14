import * as React from "react";
import { Popover } from "radix-ui";

import { cn } from "@/shared/utils/cn";

function PopoverRoot(props: React.ComponentProps<typeof Popover.Root>) {
  return <Popover.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(props: React.ComponentProps<typeof Popover.Trigger>) {
  return <Popover.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverAnchor(props: React.ComponentProps<typeof Popover.Anchor>) {
  return <Popover.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverContent({
  align = "start",
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof Popover.Content>) {
  return (
    <Popover.Portal>
      <Popover.Content
        align={align}
        className={cn(
          "z-50 rounded-md border border-border bg-surface p-2 text-foreground shadow-md outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1",
          className,
        )}
        data-slot="popover-content"
        sideOffset={sideOffset}
        {...props}
      />
    </Popover.Portal>
  );
}

export { PopoverAnchor, PopoverContent, PopoverRoot, PopoverTrigger };
