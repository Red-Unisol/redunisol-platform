import {
  ISheetClipboardService,
  SetRangeValuesMutation,
  SheetPasteShortKeyCommand,
} from "@univerjs/preset-sheets-core";
import { CellValueType } from "@univerjs/presets";
import type { FUniver, Univer } from "@univerjs/presets";
import type {
  ISheetPasteByShortKeyParams,
  ISetRangeValuesMutationParams,
} from "@univerjs/preset-sheets-core";
import { numeroArgentino, tablaNumerosArgentinos } from "./numero-argentino";

/** Convierte únicamente las escrituras de un pegado externo en esta instancia. */
export function instalarPegadoNumerico(univer: Univer, api: FUniver) {
  const clipboard = univer.__getInjector().get(ISheetClipboardService);
  let target: { unitId: string; subUnitId: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rawSingle: string | undefined;
  const clear = () => {
    target = null;
    rawSingle = undefined;
    if (timer !== undefined) clearTimeout(timer);
  };
  const hook = clipboard.addClipboardHook({
    id: "calculadora-importes-argentinos",
    priority: -1000,
    onBeforePaste: (location) => {
      clear();
      target = { unitId: location.unitId, subUnitId: location.subUnitId };
      // El pegado construye y ejecuta las mutaciones inmediatamente después de
      // este hook. Expirar al siguiente turno cubre también el texto simple,
      // cuya ruta de Univer 0.25.1 no invoca onAfterPaste.
      timer = setTimeout(clear, 0);
      return true;
    },
    onPastePlainText: (_location, text) => {
      rawSingle = text;
      return { undos: [], redos: [] };
    },
    onPasteCells: (pasteFrom, _pasteTo, data) => {
      if (pasteFrom)
        clear(); // Las copias internas mantienen valores y fórmulas.
      else
        data.forValue((_row, _column, cell) => {
          if (!cell || cell.f || cell.si) return;
          const raw =
            cell.plain ??
            (typeof cell.v === "string"
              ? cell.v
              : cell.p?.body?.dataStream.replace(/[\r\n]+$/, ""));
          const value = numeroArgentino(raw);
          // Se conserva el texto hasta la mutación para respetar el formato @
          // del destino; también evita perder miles que el parser lea como decimal.
          if (value !== null && raw) cell.v = raw;
        });
      return { undos: [], redos: [] };
    },
    onAfterPaste: clear,
  });
  const listener = api.onBeforeCommandExecute((command) => {
    if (command.id === SheetPasteShortKeyCommand.id) {
      const params = command.params as ISheetPasteByShortKeyParams;
      if (!params.htmlContent) {
        const table = tablaNumerosArgentinos(params.textContent);
        if (table) params.htmlContent = table;
      }
    }

    if (command.id !== SetRangeValuesMutation.id || !target) return;
    const params = command.params as ISetRangeValuesMutationParams;
    if (
      params.unitId !== target.unitId ||
      params.subUnitId !== target.subUnitId
    )
      return;
    if (params.trigger && /undo|redo/i.test(params.trigger)) return;
    const sheet = api
      .getWorkbook(params.unitId)
      ?.getSheetBySheetId(params.subUnitId);
    if (!sheet) return;
    const values = params.cellValue;
    if (!values) return;
    for (const row in values) {
      const cells = values[Number(row)];
      for (const column in cells) {
        const cell = cells[Number(column)];
        if (!cell || cell.f || cell.si) continue;
        const value =
          typeof cell.v === "string"
            ? cell.v
            : cell.p?.body?.dataStream.replace(/[\r\n]+$/, "");
        const number = numeroArgentino(rawSingle ?? value);
        if (typeof cell.s === "object" && cell.s?.n?.pattern === "@") continue;
        if (
          number === null ||
          sheet
            .getRange(Number(row), Number(column), 1, 1)
            .getNumberFormat() === "@"
        )
          continue;
        cell.v = number;
        cell.t = CellValueType.NUMBER;
        cell.p = null;
      }
    }
  });
  return () => {
    clear();
    listener.dispose();
    hook.dispose();
  };
}
