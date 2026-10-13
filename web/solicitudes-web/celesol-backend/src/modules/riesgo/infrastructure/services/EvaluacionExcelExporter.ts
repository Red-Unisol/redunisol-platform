import JSZip from "jszip";
import LuckyExcel from "@zwight/luckyexcel";
import { z } from "zod";

const snapshotSchema = z
  .object({
    sheets: z.record(
      z.string(),
      z
        .object({
          name: z.string().min(1),
          cellData: z
            .record(
              z.string(),
              z.record(
                z.string(),
                z
                  .object({
                    f: z.string().nullable().optional(),
                    si: z.string().nullable().optional(),
                  })
                  .passthrough()
                  .nullable(),
              ),
            )
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export async function exportarEvaluacionExcel(
  snapshot: unknown,
): Promise<Buffer> {
  const parsed = snapshotSchema.parse(snapshot);
  if (!Object.keys(parsed.sheets).length)
    throw new Error("Evaluación sin hojas");
  // Las copias antiguas pueden no incluir recursos o congelamiento.
  const normalized = {
    ...parsed,
    resources: parsed.resources ?? [],
    sheetOrder: parsed.sheetOrder ?? Object.keys(parsed.sheets),
    styles: parsed.styles ?? {},
    sheets: Object.fromEntries(
      Object.entries(parsed.sheets).map(([id, sheet]) => [
        id,
        {
          ...sheet,
          cellData: Object.fromEntries(
            Object.entries(sheet.cellData ?? {}).map(([row, cells]) => [
              row,
              Object.fromEntries(
                Object.entries(cells).map(([column, cell]) => {
                  if (!cell) return [column, cell];
                  if (cell.si && !cell.f)
                    throw new Error(
                      "Fórmula compartida sin expresión disponible",
                    );
                  const { f, ...values } = cell;
                  // LuckyExcel 1.1.6 lee las fórmulas de si; Univer las guarda en f.
                  return [
                    column,
                    f ? { ...values, si: f.replace(/^=/, "") } : values,
                  ];
                }),
              ),
            ]),
          ),
          mergeData: sheet.mergeData ?? [],
          freeze: sheet.freeze ?? {
            xSplit: 0,
            ySplit: 0,
            startRow: -1,
            startColumn: -1,
          },
        },
      ]),
    ),
  };
  const output = await new Promise<Buffer>((resolve, reject) => {
    void LuckyExcel.transformUniverToExcel({
      snapshot: normalized,
      getBuffer: true,
      success: (buffer) =>
        buffer?.byteLength
          ? resolve(Buffer.from(buffer))
          : reject(new Error("Excel vacío")),
      error: reject,
    }).catch(reject);
  });
  // LuckyExcel puede producir fracciones de EMU en los anclajes de imágenes.
  // OOXML exige enteros: redondear esas posiciones conserva el logo y evita
  // que Excel descarte el dibujo al abrir la copia.
  const zip = await JSZip.loadAsync(output);
  for (const entry of Object.values(zip.files)) {
    if (!/^xl\/drawings\/drawing\d+\.xml$/.test(entry.name)) continue;
    const xml = await entry.async("string");
    const normalizedXml = xml.replace(
      /(<(?:xdr:)?(?:colOff|rowOff)>)(-?\d+(?:\.\d+)?)(<\/[^>]+>)/g,
      (_match, open: string, value: string, close: string) =>
        `${open}${Math.round(Number(value))}${close}`,
    );
    zip.file(entry.name, normalizedXml);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
