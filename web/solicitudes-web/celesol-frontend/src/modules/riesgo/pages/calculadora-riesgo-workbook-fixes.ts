import type {
  ICellData,
  IStyleData,
  IWorkbookData,
  Nullable,
} from "@univerjs/presets";

function stripBorder(style: Nullable<IStyleData | string>) {
  if (style && typeof style === "object") {
    delete style.bd;
  }
}

/**
 * LuckyExcel's xlsx-to-Univer conversion fabricates extra cell borders
 * (e.g. a phantom right/left border copied from an adjacent filled cell)
 * that are not present in the source workbook. Stripping borders avoids
 * rendering those incorrect lines; the original fills/fonts are unaffected.
 */
export function stripLuckyExcelSpuriousBorders(
  workbookData: IWorkbookData,
): IWorkbookData {
  for (const style of Object.values(workbookData.styles ?? {})) {
    stripBorder(style);
  }

  for (const sheet of Object.values(workbookData.sheets ?? {})) {
    for (const row of Object.values(sheet.cellData ?? {})) {
      for (const cell of Object.values(row as Record<string, ICellData>)) {
        stripBorder(cell?.s);
      }
    }
  }

  return workbookData;
}
