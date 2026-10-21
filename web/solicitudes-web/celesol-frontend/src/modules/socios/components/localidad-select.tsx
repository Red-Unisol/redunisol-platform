import { ChevronDown, Search } from "lucide-react";
import { useState } from "react";

import type { Localidad } from "../types";
import {
  LOCALIDAD_MIN_SEARCH_LENGTH,
  useLocalidadQuery,
  useLocalidadesSearchQuery,
} from "../hooks/use-localidades-query";
import { legacyFieldClassName } from "@/modules/solicitudes-editor/components/fields/base";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/shared/components/ui/popover";

function formatLocalidad(localidad: Localidad) {
  const provincia = localidad.provincia ? ` (${localidad.provincia})` : "";
  const codigoPostal = localidad.codigoPostal
    ? ` · CP ${localidad.codigoPostal}`
    : "";

  return `${localidad.nombre}${provincia}${codigoPostal}`;
}

type LocalidadSelectProps = {
  disabled?: boolean;
  invalid?: boolean;
  onBlur?: () => void;
  onChange?: (id: string) => void;
  // Para quien guarda el nombre y no el id (la solicitud): el texto que se
  // muestra, la localidad elegida completa y como quitarla (campo opcional).
  onClear?: () => void;
  onPick?: (localidad: Localidad) => void;
  value: string;
  valueLabel?: string;
};

/**
 * Desplegable con buscador de las localidades de Vimarx (~22.000): se escribe
 * parte del nombre, la provincia o el CP y el backend devuelve hasta 50. Se
 * guarda el id, igual que InsCreditB.
 */
export function LocalidadSelect({
  disabled,
  invalid,
  onBlur,
  onChange,
  onClear,
  onPick,
  value,
  valueLabel,
}: LocalidadSelectProps) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [picked, setPicked] = useState<Localidad | null>(null);
  const searchQuery = useLocalidadesSearchQuery(searchTerm, open);
  const currentQuery = useLocalidadQuery(picked?.id === value ? "" : value);
  const selected = picked?.id === value ? picked : currentQuery.data;
  const isShortSearch =
    searchTerm.trim().length < LOCALIDAD_MIN_SEARCH_LENGTH;
  const results = isShortSearch ? [] : (searchQuery.data ?? []);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setSearchTerm("");
      onBlur?.();
    }

    setOpen(nextOpen);
  }

  function renderStatus() {
    if (isShortSearch) {
      return "Escribí al menos 2 letras del nombre, la provincia o el CP.";
    }

    if (searchQuery.isError) {
      return "No se pudieron cargar las localidades. Probá de nuevo.";
    }

    if (searchQuery.isFetching && results.length === 0) {
      return "Buscando...";
    }

    if (results.length === 0) {
      return "Sin coincidencias";
    }

    return null;
  }

  const status = renderStatus();

  return (
    <PopoverRoot modal onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-invalid={invalid}
          className={`${legacyFieldClassName} items-center justify-between gap-2 text-left disabled:opacity-60`}
          disabled={disabled}
          type="button"
        >
          {valueLabel !== undefined ? (
            <span
              className={valueLabel ? "truncate" : "truncate text-foreground-muted"}
            >
              {valueLabel || "Buscar localidad"}
            </span>
          ) : (
            <span
              className={selected ? "truncate" : "truncate text-foreground-muted"}
            >
              {selected
                ? formatLocalidad(selected)
                : currentQuery.isFetching
                  ? "Cargando..."
                  : "Buscar localidad"}
            </span>
          )}
          <ChevronDown className="size-4 shrink-0 text-foreground-secondary" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-h-72 w-[var(--radix-popover-trigger-width)] min-w-72 overflow-y-auto p-1">
        <div className="sticky top-0 z-10 -mx-1 -mt-1 mb-1 flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
          <Search className="size-4 shrink-0 text-foreground-secondary" />
          <input
            autoFocus
            className="w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-muted"
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Ej.: villa maria, rio cuarto 5800"
            value={searchTerm}
          />
        </div>
        {onClear && valueLabel ? (
          <button
            className="flex min-h-9 w-full items-center rounded-md px-3 py-2 text-left text-sm text-foreground-secondary transition hover:bg-background"
            onClick={() => {
              onClear();
              handleOpenChange(false);
            }}
            type="button"
          >
            Sin localidad
          </button>
        ) : null}
        {status ? (
          <div className="px-3 py-2 text-sm text-foreground-muted">
            {status}
          </div>
        ) : (
          results.map((localidad) => (
            <button
              className={`flex min-h-9 w-full items-center rounded-md px-3 py-2 text-left text-sm transition ${
                localidad.id === value
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-background"
              }`}
              key={localidad.id}
              onClick={() => {
                setPicked(localidad);
                onChange?.(localidad.id);
                onPick?.(localidad);
                handleOpenChange(false);
              }}
              type="button"
            >
              {formatLocalidad(localidad)}
            </button>
          ))
        )}
      </PopoverContent>
    </PopoverRoot>
  );
}
