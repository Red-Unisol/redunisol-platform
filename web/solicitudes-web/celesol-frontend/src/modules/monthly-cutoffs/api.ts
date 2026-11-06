import { apiClient } from "@/shared/services/http/api-client";
export const AMEJUCA_LINE_IDS = [
  "2519",
  "2657",
  "2770",
  "2771",
  "2772",
  "2774",
  "2776",
];
export const isAmejucaLine = (id: string | null | undefined) =>
  AMEJUCA_LINE_IDS.includes(id ?? "");
export function currentPeriod() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return (
    parts.find((p) => p.type === "year")!.value +
    "-" +
    parts.find((p) => p.type === "month")!.value
  );
}
export type CutoffRecord = {
  period: string;
  cutoffDate: string;
  note: string | null;
  version: number;
  updatedAt: string;
  updatedBy: string;
};
export type MonthlyCutoffData = {
  group: "AMEJUCA";
  period: string;
  status: "confirmed" | "estimated";
  record: CutoffRecord | null;
  history: Array<CutoffRecord & { previousDate: string | null }>;
  canManage: boolean;
};
export type SaveCutoffInput = {
  cutoffDate: string;
  note: string;
  expectedVersion: number;
};
export const cutoffQueryKey = (period: string) =>
  ["monthly-cutoffs", "AMEJUCA", period] as const;
export const getMonthlyCutoff = (period: string) =>
  apiClient.get<MonthlyCutoffData>(`/api/monthly-cutoffs/amejuca/${period}`);
export const saveMonthlyCutoff = (period: string, input: SaveCutoffInput) =>
  apiClient.put<MonthlyCutoffData>(
    `/api/monthly-cutoffs/amejuca/${period}`,
    input,
  );
export const displayDate = (date: string) =>
  date.split("-").reverse().join("/");
