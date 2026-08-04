import { buildRecientesDateRange } from "./recientes-date-range.ts";

function assertEqual(actual: string, expected: string) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, received ${actual}`);
  }
}

const range = buildRecientesDateRange(new Date("2026-05-18T12:00:00"));

assertEqual(range.createdFrom, "2026-04-27");
assertEqual(range.createdTo, "2026-05-18");
