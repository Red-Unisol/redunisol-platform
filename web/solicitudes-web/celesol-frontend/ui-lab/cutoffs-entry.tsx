import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/app/layouts/app-layout";
import { MonthlyCutoffScreen } from "@/modules/monthly-cutoffs/MonthlyCutoffScreen";
import type {
  MonthlyCutoffData,
  SaveCutoffInput,
} from "@/modules/monthly-cutoffs/api";

const initialPeriod = "2026-11";
const record = {
  period: initialPeriod,
  cutoffDate: "2026-11-08",
  note: "Aviso de AMEJUCA recibido el 3 de noviembre. Datos de ejemplo.",
  version: 1,
  updatedAt: "2026-11-03T13:00:00Z",
  updatedBy: "Analista de ejemplo",
};
export function App() {
  const scenario =
    new URLSearchParams(window.location.search).get("scenario") ?? "pending";
  const [period, setPeriod] = useState(initialPeriod);
  const [records, setRecords] = useState<Record<string, MonthlyCutoffData>>(
    scenario === "confirmed"
      ? {
          [initialPeriod]: {
            group: "AMEJUCA",
            period: initialPeriod,
            status: "confirmed",
            record,
            history: [{ ...record, previousDate: null }],
            canManage: true,
          },
        }
      : {},
  );
  const data = records[period] ?? {
    group: "AMEJUCA" as const,
    period,
    status: "estimated" as const,
    record: null,
    history: [],
    canManage: true,
  };
  async function save(input: SaveCutoffInput): Promise<MonthlyCutoffData> {
    if (scenario === "error")
      throw new Error("No se pudo guardar. Volvé a intentar.");
    const nextRecord = {
      ...record,
      period,
      cutoffDate: input.cutoffDate,
      note: input.note,
      version: input.expectedVersion + 1,
    };
    const next = {
      ...data,
      status: "confirmed" as const,
      record: nextRecord,
      history: [
        { ...nextRecord, previousDate: data.record?.cutoffDate ?? null },
        ...data.history,
      ],
    };
    setRecords((previous) => ({ ...previous, [period]: next }));
    return next;
  }
  return (
    <MemoryRouter initialEntries={["/solicitudes/fechas-de-corte"]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route
            path="/solicitudes/fechas-de-corte"
            element={
              <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 bg-muted px-4 py-1 text-xs text-foreground-secondary">
                  Entorno local · Datos ficticios para capacitación
                </div>
                <MonthlyCutoffScreen
                  key={period}
                  period={period}
                  onPeriodChange={setPeriod}
                  data={data}
                  onReload={async () => data}
                  onSave={save}
                />
              </div>
            }
          />
          <Route path="*" element={<p>Navegación local de ejemplo.</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}
