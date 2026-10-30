import { useState, type ReactNode } from "react";
import { ChevronDown, CircleAlert, MoreHorizontal } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { cn } from "@/shared/utils/cn";

export type AccionDeEstado = {
  clave: string;
  etiqueta: string;
  icono?: ReactNode;
  onClick: () => void;
  deshabilitada?: boolean;
  // Por que no se puede: se muestra a la vista, no solo al pasar el mouse.
  motivo?: string | null;
  // Termina la solicitud (Desestimar, Rechazar): al final del menu, en rojo.
  terminal?: boolean;
};

// Las acciones de la barra azul, iguales en todos los estados: principal en
// verde, secundaria con contorno y el resto en "Mas acciones".
export function AccionesDeEstado({
  mas = [],
  principal,
  secundaria,
}: {
  mas?: AccionDeEstado[];
  principal?: AccionDeEstado;
  secundaria?: AccionDeEstado;
}) {
  if (!principal && !secundaria && mas.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      {mas.length > 0 ? <MasAcciones acciones={mas} /> : null}
      {secundaria ? (
        <Button
          aria-label={secundaria.etiqueta}
          className="h-10 rounded-md border border-white/30 bg-transparent px-3 font-semibold text-white hover:bg-white/10 sm:px-4"
          disabled={secundaria.deshabilitada}
          onClick={secundaria.onClick}
          title={secundaria.motivo ?? undefined}
          type="button"
        >
          {secundaria.icono}
          <span className="hidden sm:inline">{secundaria.etiqueta}</span>
        </Button>
      ) : null}
      {principal ? (
        <Button
          aria-label={principal.etiqueta}
          className="h-10 rounded-md bg-verde px-3 font-semibold text-white hover:bg-verde/90 disabled:bg-white/15 disabled:text-white/70 disabled:opacity-100 sm:px-5"
          disabled={principal.deshabilitada}
          onClick={principal.onClick}
          title={principal.motivo ?? undefined}
          type="button"
        >
          {principal.icono}
          <span className="hidden sm:inline">{principal.etiqueta}</span>
        </Button>
      ) : null}
    </div>
  );
}

// Debajo de la barra, cuando la accion principal esta bloqueada: el motivo,
// a la vista (no solo al pasar el mouse).
export function MotivoBloqueo({ children }: { children: ReactNode }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs leading-snug font-medium text-amber-800">
      <CircleAlert className="size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function MasAcciones({ acciones }: { acciones: AccionDeEstado[] }) {
  const [abierto, setAbierto] = useState(false);
  const comunes = acciones.filter((accion) => !accion.terminal);
  const terminales = acciones.filter((accion) => accion.terminal);

  function item(accion: AccionDeEstado) {
    return (
      <li key={accion.clave}>
        <button
          className={cn(
            "flex w-full flex-col items-start rounded-md px-3 py-2 text-left text-sm font-medium transition hover:bg-background disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
            accion.terminal ? "text-destructive" : "text-foreground",
          )}
          disabled={accion.deshabilitada}
          onClick={() => {
            setAbierto(false);
            accion.onClick();
          }}
          type="button"
        >
          {accion.etiqueta}
          {accion.deshabilitada && accion.motivo ? (
            <span className="text-xs font-normal text-foreground-secondary">
              {accion.motivo}
            </span>
          ) : null}
        </button>
      </li>
    );
  }

  return (
    <PopoverRoot onOpenChange={setAbierto} open={abierto}>
      <PopoverTrigger asChild>
        <Button
          aria-label="Más acciones"
          title="Más acciones"
          className="h-10 rounded-md border border-white/30 bg-transparent px-3 font-semibold text-white hover:bg-white/10 data-[state=open]:bg-white/10"
          type="button"
        >
          <MoreHorizontal className="size-4 2xl:hidden" />
          <span className="hidden 2xl:inline">Más acciones</span>
          <ChevronDown className="hidden size-4 2xl:block" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        <ul>{comunes.map(item)}</ul>
        {comunes.length > 0 && terminales.length > 0 ? (
          <hr className="my-1 border-border" />
        ) : null}
        <ul>{terminales.map(item)}</ul>
      </PopoverContent>
    </PopoverRoot>
  );
}
