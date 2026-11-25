import { useState, type FormEvent } from "react";
import { Button } from "@/shared/components/ui/button";
import type { AmejucaLineAvailability, AmejucaVariant } from "./api";

type Props = {
  data?: AmejucaLineAvailability;
  isLoading?: boolean;
  onReload: () => void;
  onSave: (variant: AmejucaVariant, expectedVersion: number) => Promise<void>;
};

const options = [
  { value: "CELESOL", label: "Celesol" },
  { value: "RED_UNISOL", label: "Red Unisol" },
] as const;

export function AmejucaLineAvailabilityPanel({
  data,
  isLoading,
  onReload,
  onSave,
}: Props) {
  return (
    <section
      aria-labelledby="amejuca-lines-title"
      className="rounded-xl border border-border bg-surface p-4 md:p-5"
    >
      <h2
        id="amejuca-lines-title"
        className="text-lg font-semibold text-marino"
      >
        Disponibilidad de líneas AMEJUCA
      </h2>
      <p className="mt-1 text-sm text-foreground-secondary">
        Elegí qué variante se puede asignar al crear una solicitud o al
        cambiarle la línea. Las solicitudes existentes pueden continuar con
        su línea actual.
      </p>
      {data ? (
        <VariantForm
          key={data.version}
          current={data}
          onReload={onReload}
          onSave={onSave}
        />
      ) : isLoading ? (
        <p className="mt-4 text-sm" role="status">
          Cargando la variante activa…
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-destructive" role="alert">
            No se pudo consultar la variante activa.
          </p>
          <Button type="button" variant="outline" onClick={onReload}>
            Volver a consultar
          </Button>
        </div>
      )}
    </section>
  );
}

function VariantForm({
  current,
  onReload,
  onSave,
}: {
  current: AmejucaLineAvailability;
  onReload: Props["onReload"];
  onSave: Props["onSave"];
}) {
  const [variant, setVariant] = useState(current.variant);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const activeLabel = options.find(
    (option) => option.value === current.variant,
  )?.label;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (variant === current.variant || isSaving) return;

    setError("");
    setIsSaving(true);
    try {
      await onSave(variant, current.version);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "No se pudo guardar la variante.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3">
      <p className="text-sm font-medium" role="status">
        Variante activa: {activeLabel}
      </p>
      <fieldset disabled={isSaving} className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">Variante para altas y cambios de línea</legend>
        {options.map(({ value, label }) => (
          <label
            key={value}
            className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm font-medium"
          >
            <input
              type="radio"
              name="amejuca-variant"
              value={value}
              checked={variant === value}
              onChange={() => {
                setVariant(value);
                setError("");
              }}
              className="size-4 accent-primary"
            />
            {label}
          </label>
        ))}
      </fieldset>
      {error && (
        <div>
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
          <Button
            className="mt-2"
            type="button"
            variant="outline"
            onClick={onReload}
          >
            Volver a consultar
          </Button>
        </div>
      )}
      <Button
        className="w-full sm:w-fit"
        disabled={variant === current.variant || isSaving}
      >
        {isSaving ? "Guardando…" : "Guardar variante"}
      </Button>
    </form>
  );
}
