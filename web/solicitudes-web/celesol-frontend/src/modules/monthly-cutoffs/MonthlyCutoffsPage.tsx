import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MonthlyCutoffScreen } from "./MonthlyCutoffScreen";
import {
  currentPeriod,
  cutoffQueryKey,
  getMonthlyCutoff,
  saveMonthlyCutoff,
  type SaveCutoffInput,
} from "./api";
export function MonthlyCutoffsPage() {
  const [period, setPeriod] = useState(currentPeriod);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: cutoffQueryKey(period),
    queryFn: () => getMonthlyCutoff(period),
    refetchOnWindowFocus: false,
  });
  return (
    <MonthlyCutoffScreen
      key={period}
      period={period}
      onPeriodChange={setPeriod}
      data={query.data}
      isLoading={query.isPending}
      error={
        query.isError && !query.data
          ? "No pudimos consultar el corte. Volvé a intentar; no se confirmó ninguna fecha."
          : undefined
      }
      onReload={async () => {
        const result = await query.refetch();
        return result.isError ? undefined : result.data;
      }}
      onSave={async (input: SaveCutoffInput) => {
        const result = await saveMonthlyCutoff(period, input);
        client.setQueryData(cutoffQueryKey(period), result);
        return result;
      }}
    />
  );
}
