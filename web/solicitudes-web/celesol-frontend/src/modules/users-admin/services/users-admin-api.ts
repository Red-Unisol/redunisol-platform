import { apiClient } from "@/shared/services/http/api-client";

export type PendingAreaUser = {
  email: string;
  firstName: string;
  id: string;
  lastName: string;
  legacyUser: string;
  state: number;
  workflowOwnerId: string | null;
  workflowOwners?: WorkflowOwner[];
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
  workflowOwners?: WorkflowOwner[];
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

export type PendingAssignment = {
  id: string;
  nroSolicitud: string | null;
  areaName: string;
  areaCode: string;
  stateName: string;
};

export function assignWorkflowOwners(
  userId: string,
  workflowOwnerIds: string[],
) {
  return apiClient.patch<{
    user: UsersAdminUser;
    pendingAssignments: PendingAssignment[];
  }>(`/auth/users/${userId}/workflow-owners`, { workflowOwnerIds });
}

export function updateUser(userId: string, payload: UpdateAdminUserRequest) {
  return apiClient.patch<{ user: UsersAdminUser }>(
    `/auth/users/${userId}`,
    payload,
  );
}

export function enterUser(userId: string) {
  return apiClient.post("/auth/impersonation/start", { userId });
}
