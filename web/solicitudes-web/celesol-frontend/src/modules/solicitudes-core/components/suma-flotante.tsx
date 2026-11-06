import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { Posicion } from "@/modules/solicitudes-core/hooks/use-suma-seleccion";
import { formatNullableAmount } from "@/shared/utils/money-format";

// Cartel junto al mouse. Va en un portal al body: el contenido del dialogo
// esta transformado y ahi "fixed" no se ubica respecto de la pantalla.
export function SumaFlotante({
  cantidad,
  inicial,
  total,
}: {
  cantidad: number;
  inicial: Posicion;
  total: number;
}) {
  const [posicion, setPosicion] = useState(inicial);

  useEffect(() => {
    function alMover(event: MouseEvent) {
      setPosicion({ x: event.clientX, y: event.clientY });
    }

    window.addEventListener("mousemove", alMover);

    return () => window.removeEventListener("mousemove", alMover);
  }, []);

  const monto =
    total < 0
      ? `-${formatNullableAmount(-total)}`
      : formatNullableAmount(total);

  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed z-[60] rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-lg"
      role="status"
      style={{
        left: Math.min(posicion.x + 16, window.innerWidth - 220),
        top: Math.min(posicion.y + 16, window.innerHeight - 64),
      }}
    >
      <div className="text-xs text-foreground-secondary">
        {cantidad} {cantidad === 1 ? "celda" : "celdas"} · Suma
      </div>
      <div className="font-semibold text-foreground">{monto}</div>
    </div>,
    document.body,
  );
}
