import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  changeOwnPassword,
  getCurrentUser,
  login,
  logout,
  refreshSession,
  updateOwnProfile,
  type AuthUser,
  type ChangeOwnPasswordRequest,
  type LoginRequest,
  type UpdateOwnProfileRequest,
} from "@/modules/auth/services/auth-api";
import { ApiError } from "@/shared/services/http/api-error";

export const authQueryKeys = {
  session: ["auth", "session"] as const,
};

export async function getSessionUser() {
  try {
    const response = await getCurrentUser();
    return response.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }

    throw error;
  }
}

export function useAuthSessionQuery() {
  return useQuery({
    queryFn: getSessionUser,
    queryKey: authQueryKeys.session,
    retry: false,
  });
}

export function useLoginMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: LoginRequest) => login(payload),
    onSuccess: ({ user }) => {
      queryClient.setQueryData<AuthUser | null>(authQueryKeys.session, user);
    },
  });
}

export function useRefreshSessionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: refreshSession,
    onSuccess: ({ user }) => {
      queryClient.setQueryData<AuthUser | null>(authQueryKeys.session, user);
    },
  });
}

export function useLogoutMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: logout,
    onSettled: () => {
      queryClient.setQueryData<AuthUser | null>(authQueryKeys.session, null);
    },
  });
}

export function useUpdateOwnProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateOwnProfileRequest) => updateOwnProfile(payload),
    onSuccess: ({ user }) => {
      queryClient.setQueryData<AuthUser | null>(authQueryKeys.session, user);
    },
  });
}

export function useChangeOwnPasswordMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ChangeOwnPasswordRequest) =>
      changeOwnPassword(payload),
    onSuccess: () => {
      queryClient.setQueryData<AuthUser | null>(authQueryKeys.session, null);
    },
  });
}
