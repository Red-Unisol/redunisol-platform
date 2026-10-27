import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/shared/services/http/api-client";

export type LinkedLoanStatus = {
  status: "none" | "active" | "cancelled" | "unavailable";
  currentLoanId: string | null;
  amount: number | string | null;
  requestedAmount: number | string | null;
  matchesAmount: boolean;
  amountEditable: boolean;
  reason?: string | null;
  recovery?: {
    requestId: string;
    status: string;
    knownLoanId: string | null;
    expectedUpdatedAt: string;
  } | null;
};
export function useLinkedLoanStatus(id: string) {
  return useQuery({
    queryKey: ["solicitudes-core", "linked-loan-status", id],
    enabled: Boolean(id),
    queryFn: () =>
      apiClient.get<LinkedLoanStatus>(`/solicitudes/${id}/linked-loan-status`),
    refetchInterval: 30000,
    staleTime: 0,
  });
}
