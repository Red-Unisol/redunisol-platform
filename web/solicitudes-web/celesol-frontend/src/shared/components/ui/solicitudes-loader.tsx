import { cn } from "@/shared/utils/cn";

type SolicitudesLoaderProps = {
  centerText?: string;
  className?: string;
  label?: string;
  size?: "sm" | "md" | "lg";
};

const sizeClasses: Record<
  NonNullable<SolicitudesLoaderProps["size"]>,
  string
> = {
  sm: "size-[88px]",
  md: "size-[118px]",
  lg: "size-[140px]",
};

const centerClasses: Record<
  NonNullable<SolicitudesLoaderProps["size"]>,
  { circle: string; text: string }
> = {
  sm: {
    circle: "size-[66px]",
    text: "text-[1.05rem]",
  },
  md: {
    circle: "size-[86px]",
    text: "text-[2rem]",
  },
  lg: {
    circle: "size-[100px]",
    text: "text-[2.1rem]",
  },
};

export function SolicitudesLoader({
  centerText = "",
  className,
  label = "Carga de Solicitudes",
  size = "md",
}: SolicitudesLoaderProps) {
  return (
    <div
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-5",
        className,
      )}
      role="status"
    >
      <div className={cn("relative", sizeClasses[size])}>
        <div className="absolute inset-0 rounded-full border-[4px] border-border/90" />
        <div className="absolute inset-0 animate-spin [animation-duration:1.1s] [animation-timing-function:linear] motion-reduce:animate-none">
          <div className="absolute inset-0 rounded-full border-[4px] border-transparent border-l-primary border-b-primary" />
        </div>
        <div
          className={cn(
            "absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground",
            centerClasses[size].circle,
          )}
        >
          <span
            className={cn(
              "font-semibold tracking-tight",
              centerClasses[size].text,
            )}
          >
            {centerText}
          </span>
        </div>
      </div>

      <p className="text-center text-2xl font-medium text-foreground">
        {label}
      </p>
    </div>
  );
}
