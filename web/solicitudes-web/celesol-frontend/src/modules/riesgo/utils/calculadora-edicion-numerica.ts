import {
  AFTER_CELL_EDIT,
  SheetInterceptorService,
} from "@univerjs/preset-sheets-core";
import { CellValueType } from "@univerjs/presets";
import type { FUniver, Univer } from "@univerjs/presets";
import { numeroArgentino } from "./numero-argentino";

/** Lo tipeado en una celda acepta coma decimal, igual que el pegado. */
export function instalarEdicionNumerica(univer: Univer, api: FUniver) {
  const interceptor = univer.__getInjector().get(SheetInterceptorService);
  // Corre antes que el de formatos numéricos de Univer (prioridad 0), que
  // solo reconoce el punto decimal y deja "0,5" como texto.
  return interceptor.writeCellInterceptor.intercept(AFTER_CELL_EDIT, {
    priority: 100,
    handler: (cell, context, next) => {
      if (!cell || cell.f || cell.si || cell.t === CellValueType.FORCE_STRING)
        return next(cell);
      const raw =
        typeof cell.v === "string"
          ? cell.v
          : cell.p?.body?.dataStream.replace(/[\r\n]+$/, "");
      const number = numeroArgentino(raw);
      if (
        number === null ||
        api
          .getWorkbook(context.unitId)
          ?.getSheetBySheetId(context.subUnitId)
          ?.getRange(context.row, context.col, 1, 1)
          .getNumberFormat() === "@"
      )
        return next(cell);
      return next({ ...cell, v: number, t: CellValueType.NUMBER, p: null });
    },
  });
}
