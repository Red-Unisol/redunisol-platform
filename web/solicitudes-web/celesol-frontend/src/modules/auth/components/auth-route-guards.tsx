import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthSessionQuery } from "@/modules/auth/hooks/use-auth-session";
import {
  canAccessRiesgoTools,
  canCreateSolicitud,
  canManageUsers,
  getDefaultAuthenticatedRoute,
  isPendingAreaAssignment,
} from "@/modules/auth/utils/auth-user";
import { SolicitudesLoader } from "@/shared/components/ui/solicitudes-loader";
import { Button } from "@/shared/components/ui/button";

type AuthGuardProps = { children: ReactNode };

function sessionStatus(query: ReturnType<typeof useAuthSessionQuery>) {
  if (query.isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
        <SolicitudesLoader label="Cargando sesión" size="md" />
      </main>
    );
  }
  // A background connection failure retains the cached user and mounted form.
  // Only a confirmed 401 becomes null and takes the user to login.
  if (query.isError && !query.data) {
    return (
      <main
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 py-10 text-center"
        role="alert"
      >
        <p>
          No pudimos comprobar tu sesión. Volvé a intentar en unos segundos.
        </p>
        <Button
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? "Reconectando…" : "Volver a intentar"}
        </Button>
      </main>
    );
  }
  return null;
}

export function ProtectedRoute({ children }: AuthGuardProps) {
  const query = useAuthSessionQuery();
  const status = sessionStatus(query);
  if (status) return status;
  if (!query.data) return <Navigate replace to="/login" />;
  if (isPendingAreaAssignment(query.data))
    return <Navigate replace to="/pending-area" />;
  return <>{children}</>;
}

export function PublicOnlyRoute({ children }: AuthGuardProps) {
  const query = useAuthSessionQuery();
  const status = sessionStatus(query);
  if (status) return status;
  if (query.data)
    return <Navigate replace to={getDefaultAuthenticatedRoute(query.data)} />;
  return <>{children}</>;
}

export function PendingAreaRoute({ children }: AuthGuardProps) {
  const query = useAuthSessionQuery();
  const status = sessionStatus(query);
  if (status) return status;
  if (!query.data) return <Navigate replace to="/login" />;
  if (!isPendingAreaAssignment(query.data)) {
    return <Navigate replace to={getDefaultAuthenticatedRoute(query.data)} />;
  }
  return <>{children}</>;
}

export function AdminOnlyRoute({ children }: AuthGuardProps) {
  const query = useAuthSessionQuery();
  const status = sessionStatus(query);
  if (status) return status;
  if (!query.data) return <Navigate replace to="/login" />;
  if (isPendingAreaAssignment(query.data))
    return <Navigate replace to="/pending-area" />;
  if (!canManageUsers(query.data)) {
    return <Navigate replace to={getDefaultAuthenticatedRoute(query.data)} />;
  }
  return <>{children}</>;
}

export function RiesgoOnlyRoute({ children }: AuthGuardProps) {
  const query = useAuthSessionQuery();
  const status = sessionStatus(query);
  if (status) return status;
  if (!query.data) return <Navigate replace to="/login" />;
  if (isPendingAreaAssignment(query.data))
    return <Navigate replace to="/pending-area" />;
  if (!canAccessRiesgoTools(query.data)) {
    return <Navigate replace to={getDefaultAuthenticatedRoute(query.data)} />;
  }
  return <>{children}</>;
}

export function PrecargaRoute({ children }: AuthGuardProps) {
  const query = useAuthSessionQuery();
  const status = sessionStatus(query);
  if (status) return status;
  if (!query.data) return <Navigate replace to="/login" />;
  if (!canCreateSolicitud(query.data))
    return <Navigate replace to="/solicitudes/core/recientes" />;
  return <>{children}</>;
}
