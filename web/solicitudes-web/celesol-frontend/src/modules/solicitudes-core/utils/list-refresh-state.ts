export type ListRefreshStateInput = {
  hasData: boolean;
  isFetching: boolean;
  isLoading: boolean;
  isManualRefreshPending: boolean;
};

export type ListRefreshState = {
  isBackgroundRefreshing: boolean;
  isInitialLoading: boolean;
  isRefreshActionDisabled: boolean;
};

type ListRefreshRunnerInput = {
  isRefreshActionDisabled: boolean;
  isRefreshPendingRef: { current: boolean };
  refetch: () => Promise<unknown>;
  setIsManualRefreshPending: (value: boolean) => void;
};

export function resolveListRefreshState({
  hasData,
  isFetching,
  isLoading,
  isManualRefreshPending,
}: ListRefreshStateInput): ListRefreshState {
  const isInitialLoading = (isFetching || isLoading) && !hasData;
  const isBackgroundRefreshing = isFetching && hasData;

  return {
    isBackgroundRefreshing,
    isInitialLoading,
    isRefreshActionDisabled: isFetching || isManualRefreshPending,
  };
}

export async function runListManualRefresh({
  isRefreshActionDisabled,
  isRefreshPendingRef,
  refetch,
  setIsManualRefreshPending,
}: ListRefreshRunnerInput): Promise<boolean> {
  if (isRefreshActionDisabled || isRefreshPendingRef.current) {
    return false;
  }

  isRefreshPendingRef.current = true;
  setIsManualRefreshPending(true);

  try {
    await refetch();
    return true;
  } finally {
    isRefreshPendingRef.current = false;
    setIsManualRefreshPending(false);
  }
}

// Precarga, Recientes e Historicas se vuelven a pedir solas cada minuto, para
// ver los cambios que hacen otros (un envio a Riesgo, una aprobacion) sin
// recargar. React Query no consulta mientras la pestaña esta oculta.
export const LISTAS_REFRESCO_AUTOMATICO_MS = 60_000;
