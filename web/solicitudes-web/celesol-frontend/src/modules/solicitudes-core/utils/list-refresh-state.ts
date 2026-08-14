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
