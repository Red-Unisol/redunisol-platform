import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { cn } from "@/shared/utils/cn";

import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from "./tooltip";

function truncateId(value: string, headLength = 8, tailLength = 4) {
  if (value.length <= headLength + tailLength + 1) {
    return value;
  }
  return `${value.slice(0, headLength)}…${value.slice(-tailLength)}`;
}

function IdChip({
  className,
  value,
  variant = "neutral",
}: {
  className?: string;
  value: string;
  variant?: "accent" | "neutral";
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <TooltipRoot>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs",
              variant === "accent"
                ? "border-blue-300 bg-blue-50 text-blue-700"
                : "border-input-border bg-background text-foreground-secondary",
              className,
            )}
          >
            {truncateId(value)}
            <button
              aria-label="Copiar"
              className="text-foreground-muted transition-colors hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                void handleCopy();
              }}
              type="button"
            >
              {copied ? (
                <Check className="size-3" />
              ) : (
                <Copy className="size-3" />
              )}
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{value}</TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}

export { IdChip };
