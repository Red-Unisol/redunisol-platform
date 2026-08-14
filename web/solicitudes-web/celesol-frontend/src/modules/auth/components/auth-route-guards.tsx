import { useEffect, type ReactNode } from "react";
import { Navigate } from "react-router-dom";

import {
  useAuthSessionQuery,
  useRefreshSessionMutation,
} from "@/modules/auth/hooks/use-auth-session";
import {
  canAccessRiesgoTools,
  canManageUsers,
  getDefaultAuthenticatedRoute,
  isPendingAreaAssignment,
} from "@/modules/auth/utils/auth-user";
import { SolicitudesLoader } from "@/shared/components/ui/solicitudes-loader";

type AuthGuardProps = {
  children: ReactNode;
};

function FullPageAuthLoader() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <SolicitudesLoader label="Cargando sesión" size="md" />
    </main>
  );
}

export function ProtectedRoute({ children }: AuthGuardProps) {
  const sessionQuery = useAuthSessionQuery();
  const refreshMutation = useRefreshSessionMutation();

  useEffect(() => {
    if (
      sessionQuery.isPending ||
      sessionQuery.data !== null ||
      refreshMutation.isPending ||
      refreshMutation.isSuccess ||
      refreshMutation.isError
    ) {
      return;
    }

    refreshMutation.mutate();
  }, [refreshMutation, sessionQuery.data, sessionQuery.isPending]);

  if (
    sessionQuery.isPending ||
    refreshMutation.isPending ||
    (!sessionQuery.data && refreshMutation.isIdle)
  ) {
    return <FullPageAuthLoader />;
  }

  if (sessionQuery.data) {
    if (isPendingAreaAssignment(sessionQuery.data)) {
      return <Navigate replace to="/pending-area" />;
    }

    return <>{children}</>;
  }

  return <Navigate replace to="/login" />;
}

export function PublicOnlyRoute({ children }: AuthGuardProps) {
  const sessionQuery = useAuthSessionQuery();

  if (sessionQuery.isPending) {
    return <FullPageAuthLoader />;
  }

  if (sessionQuery.data) {
    return (
      <Navigate replace to={getDefaultAuthenticatedRoute(sessionQuery.data)} />
    );
  }

  return <>{children}</>;
}

export function PendingAreaRoute({ children }: AuthGuardProps) {
  const sessionQuery = useAuthSessionQuery();
  const refreshMutation = useRefreshSessionMutation();

  useEffect(() => {
    if (
      sessionQuery.isPending ||
      sessionQuery.data !== null ||
      refreshMutation.isPending ||
      refreshMutation.isSuccess ||
      refreshMutation.isError
    ) {
      return;
    }

    refreshMutation.mutate();
  }, [refreshMutation, sessionQuery.data, sessionQuery.isPending]);

  if (
    sessionQuery.isPending ||
    refreshMutation.isPending ||
    (!sessionQuery.data && refreshMutation.isIdle)
  ) {
    return <FullPageAuthLoader />;
  }

  if (!sessionQuery.data) {
    return <Navigate replace to="/login" />;
  }

  if (!isPendingAreaAssignment(sessionQuery.data)) {
    return (
      <Navigate replace to={getDefaultAuthenticatedRoute(sessionQuery.data)} />
    );
  }

  return <>{children}</>;
}

export function AdminOnlyRoute({ children }: AuthGuardProps) {
  const sessionQuery = useAuthSessionQuery();
  const refreshMutation = useRefreshSessionMutation();

  useEffect(() => {
    if (
      sessionQuery.isPending ||
      sessionQuery.data !== null ||
      refreshMutation.isPending ||
      refreshMutation.isSuccess ||
      refreshMutation.isError
    ) {
      return;
    }

    refreshMutation.mutate();
  }, [refreshMutation, sessionQuery.data, sessionQuery.isPending]);

  if (
    sessionQuery.isPending ||
    refreshMutation.isPending ||
    (!sessionQuery.data && refreshMutation.isIdle)
  ) {
    return <FullPageAuthLoader />;
  }

  if (!sessionQuery.data) {
    return <Navigate replace to="/login" />;
  }

  if (isPendingAreaAssignment(sessionQuery.data)) {
    return <Navigate replace to="/pending-area" />;
  }

  if (!canManageUsers(sessionQuery.data)) {
    return (
      <Navigate replace to={getDefaultAuthenticatedRoute(sessionQuery.data)} />
    );
  }

  return <>{children}</>;
}

export function RiesgoOnlyRoute({ children }: AuthGuardProps) {
  const sessionQuery = useAuthSessionQuery();
  const refreshMutation = useRefreshSessionMutation();

  useEffect(() => {
    if (
      sessionQuery.isPending ||
      sessionQuery.data !== null ||
      refreshMutation.isPending ||
      refreshMutation.isSuccess ||
      refreshMutation.isError
    ) {
      return;
    }

    refreshMutation.mutate();
  }, [refreshMutation, sessionQuery.data, sessionQuery.isPending]);

  if (
    sessionQuery.isPending ||
    refreshMutation.isPending ||
    (!sessionQuery.data && refreshMutation.isIdle)
  ) {
    return <FullPageAuthLoader />;
  }

  if (!sessionQuery.data) {
    return <Navigate replace to="/login" />;
  }

  if (isPendingAreaAssignment(sessionQuery.data)) {
    return <Navigate replace to="/pending-area" />;
  }

  if (!canAccessRiesgoTools(sessionQuery.data)) {
    return (
      <Navigate replace to={getDefaultAuthenticatedRoute(sessionQuery.data)} />
    );
  }

  return <>{children}</>;
}
