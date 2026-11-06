import {
  useCallback,
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { SumaFlotante } from "@/modules/solicitudes-core/components/suma-flotante";

type Seleccion<C extends string> = {
  columna: C;
  valores: Map<string, number>;
};

export type Posicion = { x: number; y: number };

// Lo que recibe cada celda sumable.
export type PropsCeldaSumable = {
  "aria-selected": true | undefined;
  className: string;
  onClick: (event: ReactMouseEvent) => void;
};

// Ctrl+clic (Cmd en Mac) sobre celdas de montos de una misma columna para
// ver su suma, como la barra de estado de Excel. Un clic en otra columna
// empieza de nuevo; un clic sin Ctrl o Esc borra la seleccion.
export function useSumaSeleccion<C extends string>() {
  const [seleccion, setSeleccion] = useState<Seleccion<C> | null>(null);
  const [posicion, setPosicion] = useState<Posicion | null>(null);
  const activa = seleccion !== null;

  const limpiar = useCallback(() => setSeleccion(null), []);

  useEffect(() => {
    if (!activa) {
      return;
    }

    function alPresionar(event: PointerEvent) {
      if (!event.ctrlKey && !event.metaKey) {
        setSeleccion(null);
      }
    }

    // En captura y antes que el dialogo: el primer Esc borra la seleccion
    // y no cierra la ventana.
    function alTeclear(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        setSeleccion(null);
      }
    }

    window.addEventListener("pointerdown", alPresionar, true);
    window.addEventListener("keydown", alTeclear, true);

    return () => {
      window.removeEventListener("pointerdown", alPresionar, true);
      window.removeEventListener("keydown", alTeclear, true);
    };
  }, [activa]);

  function alClic(
    event: ReactMouseEvent,
    columna: C,
    clave: string,
    valor: number | null,
  ) {
    if (!(event.ctrlKey || event.metaKey) || valor === null) {
      return;
    }

    setPosicion({ x: event.clientX, y: event.clientY });
    setSeleccion((actual) => {
      const valores =
        actual?.columna === columna
          ? new Map(actual.valores)
          : new Map<string, number>();

      if (valores.has(clave)) {
        valores.delete(clave);
      } else {
        valores.set(clave, valor);
      }

      return valores.size ? { columna, valores } : null;
    });
  }

  function estaSeleccionada(columna: C, clave: string) {
    return seleccion?.columna === columna && seleccion.valores.has(clave);
  }

  // Props para una celda sumable.
  function celda(
    columna: C,
    clave: string,
    valor: number | null,
  ): PropsCeldaSumable {
    const seleccionada = estaSeleccionada(columna, clave);

    return {
      "aria-selected": seleccionada || undefined,
      className: seleccionada
        ? "bg-primary/15 outline-2 -outline-offset-2 outline-primary"
        : "",
      onClick: (event: ReactMouseEvent) => alClic(event, columna, clave, valor),
    };
  }

  const flotante =
    seleccion && posicion ? (
      <SumaFlotante
        cantidad={seleccion.valores.size}
        inicial={posicion}
        total={sumarSeleccion(seleccion.valores)}
      />
    ) : null;

  return { celda, flotante, limpiar };
}

function sumarSeleccion(valores: Map<string, number>) {
  let total = 0;

  for (const valor of valores.values()) {
    total += valor;
  }

  // Centavos, para no arrastrar el error de los decimales.
  return Math.round(total * 100) / 100;
}
