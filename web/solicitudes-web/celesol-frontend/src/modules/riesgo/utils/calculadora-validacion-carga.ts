import {
  SheetInterceptorService,
  VALIDATE_CELL,
} from "@univerjs/preset-sheets-core";
import { CellValueType } from "@univerjs/presets";
import type { FUniver, ICellData, Nullable, Univer } from "@univerjs/presets";
import { toast } from "sonner";

import { CALCULADORA_DATOS_SHEET_NAME } from "../pages/calculadora-riesgo-datos-mapping";
import { referenciasDeFormula } from "./celdas-de-carga";

// Un rango más grande es una tabla de búsqueda, no celdas que se cargan.
const MAX_CELDAS_POR_RANGO = 500;

const esFormula = (cell: Nullable<ICellData>) => Boolean(cell?.f || cell?.si);

/**
 * Celdas de carga: las que leen las fórmulas y hoy están vacías o tienen un
 * número. Los títulos que alguna fórmula lee quedan afuera porque tienen texto,
 * y la hoja Datos la completa el sistema.
 */
function celdasDeCarga(api: FUniver) {
  const sheets = api.getActiveWorkbook()?.getSheets() ?? [];
  const porNombre = new Map(sheets.map((s) => [s.getSheetName(), s]));
  const carga = new Set<string>();
  for (const sheet of sheets)
    for (const fila of sheet.getDataRange().getFormulas())
      for (const formula of fila) {
        if (!formula) continue;
        for (const ref of referenciasDeFormula(formula, sheet.getSheetName())) {
          const destino = porNombre.get(ref.hoja);
          if (
            !destino ||
            ref.hoja === CALCULADORA_DATOS_SHEET_NAME ||
            (ref.endRow - ref.startRow + 1) *
              (ref.endColumn - ref.startColumn + 1) >
              MAX_CELDAS_POR_RANGO
          )
            continue;
          const worksheet = destino.getSheet();
          for (let row = ref.startRow; row <= ref.endRow; row++)
            for (let col = ref.startColumn; col <= ref.endColumn; col++) {
              const cell = worksheet.getCellRaw(row, col);
              if (
                !esFormula(cell) &&
                (cell?.v == null || cell.v === "" || typeof cell.v === "number")
              )
                carga.add(`${destino.getSheetId()}!${row}!${col}`);
            }
        }
      }
  return carga;
}

/** En las celdas de carga, lo tipeado tiene que ser un número (o una fórmula). */
export function instalarValidacionCarga(univer: Univer, api: FUniver) {
  const carga = celdasDeCarga(api);
  const interceptor = univer.__getInjector().get(SheetInterceptorService);
  // Corre después de grabar lo tipeado (y de convertir la coma decimal); si
  // devuelve false, Univer deshace la edición.
  return interceptor.writeCellInterceptor.intercept(VALIDATE_CELL, {
    handler: (anterior, context, next) =>
      next(
        (async () => {
          if ((await anterior) === false) return false;
          const key = `${context.subUnitId}!${context.row}!${context.col}`;
          if (!carga.has(key)) return true;
          const cell = context.worksheet.getCellRaw(context.row, context.col);
          const vacia = cell?.v == null || cell.v === "";
          if (
            esFormula(cell) ||
            (vacia && !cell?.p) ||
            cell?.t === CellValueType.NUMBER ||
            typeof cell?.v === "number"
          )
            return true;
          toast.error("Esta celda espera un número.", {
            description:
              "Usá solo dígitos, con coma o punto para los decimales.",
          });
          return false;
        })(),
      ),
  });
}
