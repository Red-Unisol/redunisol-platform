import { Clock3, Wrench } from "lucide-react";

type UnderConstructionStateProps = {
  badgeLabel?: string;
  description?: string;
  title?: string;
};

const DEFAULT_TITLE = "Este sitio está en construcción";
const DEFAULT_DESCRIPTION =
  "Estamos trabajando para habilitar esta sección pronto. Gracias por tu paciencia.";
const DEFAULT_BADGE_LABEL = "Proximamente";

export function UnderConstructionState({
  badgeLabel = DEFAULT_BADGE_LABEL,
  description = DEFAULT_DESCRIPTION,
  title = DEFAULT_TITLE,
}: UnderConstructionStateProps) {
  return (
    <section className="relative w-full max-w-3xl overflow-hidden rounded-3xl border border-border-soft bg-surface px-6 py-10 shadow-[0_18px_45px_rgba(15,23,42,0.08)] sm:px-10 sm:py-14">
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-primary/8 via-primary/4 to-transparent" />
      <div className="absolute -left-12 top-12 size-28 rounded-full bg-sky-100/60 blur-2xl" />
      <div className="absolute -right-10 bottom-8 size-32 rounded-full bg-orange-100/70 blur-2xl" />

      <div className="relative flex flex-col items-center text-center">
        <div className="relative mb-6 flex items-center justify-center">
          <div className="absolute size-28 rounded-full bg-slate-100" />
          <div className="absolute inset-x-3 bottom-1 h-3 rounded-full bg-slate-200/70 blur-sm" />
          <div className="relative z-10 flex size-20 items-center justify-center rounded-[1.75rem] border border-white/70 bg-white shadow-lg shadow-slate-200/70">
            <Wrench className="size-10 text-primary" strokeWidth={1.8} />
          </div>
          <div className="absolute -right-3 -top-1 z-20 flex size-10 items-center justify-center rounded-full border border-sky-100 bg-sky-50 text-sky-600 shadow-sm">
            <Clock3 className="size-5" strokeWidth={1.9} />
          </div>
        </div>

        <span className="inline-flex items-center rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-xs font-semibold tracking-wide text-primary">
          {badgeLabel}
        </span>

        <h2 className="mt-5 max-w-xl text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-secondary sm:text-base">
          {description}
        </p>

        <div className="mt-8 flex w-full max-w-sm items-center gap-4 text-foreground-muted">
          <div className="h-px flex-1 bg-border-soft" />
          <div className="flex size-9 items-center justify-center rounded-full border border-sky-100 bg-sky-50 text-sky-600">
            <Clock3 className="size-4" strokeWidth={2} />
          </div>
          <div className="h-px flex-1 bg-border-soft" />
        </div>
      </div>
    </section>
  );
}
