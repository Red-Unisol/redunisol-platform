import { apiClient } from "@/shared/services/http/api-client";

export type LoginRequest = {
  identifier: string;
  password: string;
};

export type AuthWorkflowOwner = {
  code: string;
  id: string;
  name: string;
};

export type AuthUser = {
  email: string;
  emailVerified: boolean;
  firstName: string | null;
  id: string;
  isSystemAdmin: boolean;
  lastName: string | null;
  legacyUser: string;
  state: number;
  workflowOwnerId: string | null;
  workflowOwner: AuthWorkflowOwner | null;
};

export type LoginResponse = {
  user: AuthUser;
};

export type RegisterRequest = {
  email: string;
  firstName: string;
  lastName: string;
  legacyUser: string;
  password: string;
};

export type RegisterResponse = {
  message?: string;
  user: AuthUser;
  verificationEmailSent: boolean;
};

export type VerifyEmailRequest = {
  code: string;
  email?: string;
  identifier?: string;
};

export type ResendVerificationCodeRequest = {
  identifier: string;
};

export type RequestPasswordResetRequest = {
  email: string;
};

export type ResetPasswordRequest = {
  password: string;
  token: string;
};

export function login(payload: LoginRequest) {
  return apiClient.post<LoginResponse>("/auth/login", payload);
}

export function getCurrentUser() {
  return apiClient.get<LoginResponse>("/auth/me");
}

export function refreshSession() {
  return apiClient.post<LoginResponse>("/auth/refresh");
}

export function logout() {
  return apiClient.post<void>("/auth/logout");
}

export function register(payload: RegisterRequest) {
  return apiClient.post<RegisterResponse>("/auth/register", payload);
}

export function verifyEmail(payload: VerifyEmailRequest) {
  return apiClient.post<LoginResponse>("/auth/verify-email", payload);
}

export function resendVerificationCode(payload: ResendVerificationCodeRequest) {
  return apiClient.post<{ message: string }>(
    "/auth/resend-verification-code",
    payload,
  );
}

export function requestPasswordReset(payload: RequestPasswordResetRequest) {
  return apiClient.post<{ message: string }>("/auth/forgot-password", payload);
}

export function resetPassword(payload: ResetPasswordRequest) {
  return apiClient.post<{ message: string }>("/auth/reset-password", payload);
}

export type UpdateOwnProfileRequest = {
  email?: string;
  firstName?: string;
  lastName?: string;
};

export type ChangeOwnPasswordRequest = {
  currentPassword: string;
  newPassword: string;
};

export function updateOwnProfile(payload: UpdateOwnProfileRequest) {
  return apiClient.patch<LoginResponse>("/auth/me", payload);
}

export function changeOwnPassword(payload: ChangeOwnPasswordRequest) {
  return apiClient.post<{ message: string }>(
    "/auth/me/change-password",
    payload,
  );
}
