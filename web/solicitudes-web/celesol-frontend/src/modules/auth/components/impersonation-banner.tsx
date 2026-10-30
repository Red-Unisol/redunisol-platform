import { useEffect, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import {
  getImpersonationContext,
  stopImpersonation,
  logout,
} from "../services/auth-api";

import { IDENTITY_EVENT, reloadIdentity } from "../utils/reload-identity";
export function ImpersonationBanner({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const context = useQuery({
    queryKey: ["auth", "impersonation"],
    queryFn: getImpersonationContext,
    retry: false,
  });
  const stop = useMutation({
    mutationFn: stopImpersonation,
    onSuccess: async () => {
      await client.cancelQueries();
      client.clear();
      reloadIdentity("/admin/users");
    },
    onError: (error) => toast.error(error.message),
  });
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === IDENTITY_EVENT) window.location.replace("/dashboard");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  if (context.isPending)
    return (
      <p role="status" className="p-4">
        Cargando contexto de sesión…
      </p>
    );
  if (context.isError)
    return (
      <div role="alert" className="p-4">
        <p>
          No se pudo verificar el contexto de acceso. Volvé a intentar o cerrá
          la sesión.
        </p>
        <Button onClick={() => void context.refetch()}>Reintentar</Button>
        <Button
          onClick={async () => {
            await logout().catch(() => undefined);
            client.clear();
            reloadIdentity("/login");
          }}
        >
          Cerrar sesión
        </Button>
      </div>
    );
  if (!context.data?.context) return <>{children}</>;
  const acting = context.data.context;
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <aside
        aria-label="Acceso como otro usuario"
        className="sticky top-0 z-[100] flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-500 bg-amber-100 px-4 py-2 text-sm text-slate-900"
      >
        <div>
          <strong>Operando como {acting.selectedUser.label}</strong>
          <p>Administrador real: {acting.administrator.label}</p>
          {!acting.active && (
            <p>El acceso finalizó. Regresá a tu usuario administrador.</p>
          )}
        </div>
        <Button
          disabled={stop.isPending}
          onClick={() => stop.mutate()}
          type="button"
          variant="outline"
        >
          Volver a mi usuario administrador
        </Button>
      </aside>
      {/* El layout ocupa el alto que deja la franja (si no, h-dvh suma un scroll). */}
      <div className="min-h-0 flex-1 overflow-auto [&>.app-layout]:h-full">
        {stop.isPending ? (
          <p role="status" className="p-4">
            Volviendo al administrador…
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
