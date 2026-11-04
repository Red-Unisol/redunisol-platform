import type { FWorkbook } from "@univerjs/preset-sheets-core";
import {
  INTERCEPTOR_POINT,
  InterceptCellContentPriority,
  SheetInterceptorService,
} from "@univerjs/preset-sheets-core";
import { CellValueType, InterceptorEffectEnum } from "@univerjs/presets";
import type { Univer } from "@univerjs/presets";

/** "27234.12" -> "27234,12". Redondea a 15 cifras como Excel (0.1 + 0.2). */
export function numeroGeneralConComa(valor: number) {
  return String(Number(valor.toPrecision(15))).replace(".", ",");
}

/**
 * La calculadora muestra los números con coma decimal:
 * - celdas con formato ("$#,##0.00"): Univer las formatea con el idioma de
 *   números, que por defecto es inglés aunque la interfaz esté en español;
 * - celdas en General (las que carga Riesgo): Univer muestra el número tal
 *   cual, siempre con punto, así que se reemplaza al dibujarlas.
 * Solo cambia lo que se ve; el valor de la celda y las fórmulas no se tocan.
 */
export function instalarFormatoArgentino(univer: Univer, workbook: FWorkbook) {
  workbook.setNumfmtLocal("es");
  const interceptor = univer.__getInjector().get(SheetInterceptorService);
  // Corre después del de formatos (mayor prioridad corre antes): si la celda
  // tenía formato, ya llega como texto y no se toca.
  const registro = interceptor.intercept(INTERCEPTOR_POINT.CELL_CONTENT, {
    effect: InterceptorEffectEnum.Value,
    priority: InterceptCellContentPriority.NUMFMT - 1,
    handler: (cell, _location, next) => {
      if (
        !cell ||
        (cell.t != null && cell.t !== CellValueType.NUMBER) ||
        typeof cell.v !== "number" ||
        Number.isInteger(cell.v)
      )
        return next(cell);
      return next({ ...cell, v: numeroGeneralConComa(cell.v) });
    },
  });
  return () => registro.dispose();
}
