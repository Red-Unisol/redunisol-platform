import assert from "node:assert/strict";
import { it } from "node:test";
import { readFile } from "node:fs/promises";
import type { IWorkbookData } from "@univerjs/core";
import LuckyExcel from "@zwight/luckyexcel";
import ExcelJS from "exceljs";
import { exportarEvaluacionExcel } from "./EvaluacionExcelExporter";

it("exporta el libro real con todas sus hojas, modificaciones, estilos y fórmulas", async () => {
  const file = Object.assign(
    await readFile("docs/calculadora-riesgo/CALCULADORA MUTUAL.xlsx"),
    { name: "Calculadora.xlsx" },
  );
  const snapshot = await new Promise<IWorkbookData>((resolve, reject) =>
    LuckyExcel.transformExcelToUniver(file as unknown as File, resolve, reject),
  );
  const sheet = snapshot.sheets[snapshot.sheetOrder[0]];
  sheet.cellData ??= {};
  sheet.cellData[199] = {
    0: { v: "Evaluación del analista" },
    1: { v: 12345.67 },
    2: { f: "=B200*2", v: 24691.34 },
  };
  const buffer = await exportarEvaluacionExcel(snapshot);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  assert.deepEqual(
    workbook.worksheets.map((s) => s.name),
    snapshot.sheetOrder.map((id) => snapshot.sheets[id].name),
  );
  assert.equal(workbook.worksheets.length, 11);
  const exported = workbook.worksheets[0];
  assert.equal(exported.getCell("A200").value, "Evaluación del analista");
  assert.equal(exported.getCell("B200").value, 12345.67);
  assert.equal(exported.getCell("C200").formula, "B200*2");
  assert.equal(exported.getCell("C200").result, 24691.34);
  // El libro conserva celdas combinadas y estilos del archivo real.
  const original = new ExcelJS.Workbook();
  await original.xlsx.load(
    file as unknown as Parameters<typeof original.xlsx.load>[0],
  );
  assert.deepEqual(
    exported.getCell("B3").fill,
    original.worksheets[0].getCell("B3").fill,
  );
  assert.ok(workbook.worksheets.some((s) => s.getImages().length > 0));
  assert.ok(
    exported.getCell("C200").numFmt === "General" ||
      exported.getCell("C200").numFmt === undefined,
  );
  for (const id of snapshot.sheetOrder) {
    const sourceSheet = snapshot.sheets[id];
    const outputSheet = workbook.getWorksheet(sourceSheet.name)!;
    for (const [r, cells] of Object.entries(sourceSheet.cellData ?? {})) {
      for (const [c, cell] of Object.entries(cells)) {
        if (
          cell &&
          typeof cell === "object" &&
          "f" in cell &&
          typeof cell.f === "string"
        ) {
          assert.equal(
            outputSheet.getCell(Number(r) + 1, Number(c) + 1).formula,
            cell.f.replace(/^=/, ""),
          );
        }
      }
    }
  }
});

it("no inventa un Excel ante una evaluación sin hojas", async () => {
  await assert.rejects(() => exportarEvaluacionExcel({ sheets: {} }));
});
