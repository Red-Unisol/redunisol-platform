import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthSessionQuery } from "@/modules/auth/hooks/use-auth-session";
import { AmejucaLineAvailabilityPanel } from "./AmejucaLineAvailabilityPanel";
import { MonthlyCutoffScreen } from "./MonthlyCutoffScreen";
import {
  amejucaLineAvailabilityQueryKey,
  getAmejucaLineAvailability,
  saveAmejucaLineAvailability,
  currentPeriod,
  cutoffQueryKey,
  getMonthlyCutoff,
  saveMonthlyCutoff,
  type SaveCutoffInput,
} from "./api";
export function MonthlyCutoffsPage() {
  const [period, setPeriod] = useState(currentPeriod);
  const client = useQueryClient();
  const auth = useAuthSessionQuery();
  const isAdmin = auth.data?.isSystemAdmin === true;
  const lineAvailability = useQuery({
    queryKey: amejucaLineAvailabilityQueryKey,
    queryFn: getAmejucaLineAvailability,
    enabled: isAdmin,
  });
  const query = useQuery({
    queryKey: cutoffQueryKey(period),
    queryFn: () => getMonthlyCutoff(period),
    refetchOnWindowFocus: false,
  });
  return (
    <MonthlyCutoffScreen
      key={period}
      period={period}
      lineAvailabilityPanel={
        isAdmin && (
          <AmejucaLineAvailabilityPanel
            data={lineAvailability.data}
            isLoading={lineAvailability.isFetching}
            onReload={() => {
              void lineAvailability.refetch();
            }}
            onSave={async (variant, expectedVersion) => {
              const current = await saveAmejucaLineAvailability(
                variant,
                expectedVersion,
              );
              await client.cancelQueries({
                queryKey: amejucaLineAvailabilityQueryKey,
              });
              client.setQueryData(amejucaLineAvailabilityQueryKey, current);
            }}
          />
        )
      }
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
