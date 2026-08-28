import { apiClient } from "@/shared/services/http/api-client";

export type PendingAreaUser = {
  email: string;
  firstName: string;
  id: string;
  lastName: string;
  legacyUser: string;
  state: number;
  workflowOwnerId: string | null;
};

export type UsersAdminUser = {
  email: string;
  emailVerified: boolean;
  firstName: string;
  id: string;
  isSystemAdmin: boolean;
  lastName: string;
  legacyUser: string;
  recibeAsignacionAutomatica: boolean;
  state: number;
  workflowOwnerId: string | null;
};

export type WorkflowOwner = {
  code: string;
  id: string;
  name: string;
};

export type UpdateAdminUserRequest = {
  email?: string;
  firstName?: string;
  isSystemAdmin?: boolean;
  lastName?: string;
  legacyUser?: string;
  recibeAsignacionAutomatica?: boolean;
  state?: 0 | 1;
};

type PendingAreaUsersResponse = {
  users: PendingAreaUser[];
};

type UsersResponse = {
  users: UsersAdminUser[];
};

type WorkflowOwnersResponse = {
  workflowOwners: WorkflowOwner[];
};

export function getUsers() {
  return apiClient.get<UsersResponse>("/auth/users");
}

export function getPendingAreaUsers() {
  return apiClient.get<PendingAreaUsersResponse>("/auth/users/pending-area");
}

export function getWorkflowOwners() {
  return apiClient.get<WorkflowOwnersResponse>("/auth/workflow-owners");
}

export function assignWorkflowOwner(
  userId: string,
  workflowOwnerId: string | null,
) {
  return apiClient.patch<void>(`/auth/users/${userId}/workflow-owner`, {
    workflowOwnerId,
  });
}

export function updateUser(userId: string, payload: UpdateAdminUserRequest) {
  return apiClient.patch<{ user: UsersAdminUser }>(
    `/auth/users/${userId}`,
    payload,
  );
}
