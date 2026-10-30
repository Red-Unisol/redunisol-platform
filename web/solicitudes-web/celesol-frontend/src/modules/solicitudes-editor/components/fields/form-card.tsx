import type { ReactNode } from "react";

import { cn } from "@/shared/utils/cn";

import { RequiredMark } from "./base";

// Piezas del formulario de Nueva solicitud: tarjeta blanca, grupos y campos con
// la etiqueta arriba (en vez de la columna fija de etiquetas del legado).

export function FormCard({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-sm text-foreground-secondary">
            {description}
          </p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export function FieldGroup({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <div className="border-t border-border-soft pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-3 text-sm font-medium text-foreground-secondary">
        {title}
      </h3>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        {children}
      </div>
    </div>
  );
}

export function StackedField({
  children,
  className,
  error,
  extra,
  hint,
  label,
  required,
}: {
  children: ReactNode;
  className?: string;
  // Motivo del error, debajo del campo (no solo el borde rojo).
  error?: string;
  // Junto a la etiqueta, p. ej. "lo pide Riesgo".
  extra?: ReactNode;
  hint?: ReactNode;
  label: string;
  required?: boolean;
}) {
  return (
    <label className={cn("grid min-w-0 content-start gap-1", className)}>
      <span className="text-xs font-medium text-foreground-secondary">
        {label}
        {required ? <RequiredMark /> : null}
        {extra}
      </span>
      {children}
      {error ? (
        <span className="text-xs font-medium text-destructive">{error}</span>
      ) : hint ? (
        <span className="text-xs text-foreground-muted">{hint}</span>
      ) : null}
    </label>
  );
}
