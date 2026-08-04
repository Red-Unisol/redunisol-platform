import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { useLogoutMutation } from "@/modules/auth/hooks/use-auth-session";
import { Button } from "@/shared/components/ui/button";

const LOGOUT_REQUEST_TOAST_ID = "pending-area-logout-request-error";

export function PendingAreaPage() {
  const navigate = useNavigate();
  const logoutMutation = useLogoutMutation();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    toast.dismiss(LOGOUT_REQUEST_TOAST_ID);
    setIsLoggingOut(true);

    try {
      await logoutMutation.mutateAsync();
      navigate("/login", { replace: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo desconectar.";

      toast.error(message, {
        duration: 3500,
        id: LOGOUT_REQUEST_TOAST_ID,
      });
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <section className="w-full max-w-[430px]">
      <div className="mx-auto mb-4 flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
        <CircleAlert className="size-4.5" />
      </div>

      <div className="rounded-md border border-border bg-surface px-6 py-5 shadow-[0_4px_10px_rgba(0,0,0,0.07)]">
        <header>
          <h1 className="text-center text-[1.85rem] leading-tight font-semibold text-foreground">
            Cuenta pendiente
          </h1>
          <p className="mt-2 text-center text-sm text-foreground-secondary">
            Tu cuenta está activa, pero todavía no tiene un área operativa
            asignada.
          </p>
          <p className="mt-2 text-center text-sm text-foreground-secondary">
            Hasta que un administrador complete esa asignación, no vas a poder
            acceder a los módulos operativos del sistema.
          </p>
          <p className="mt-2 text-center text-sm text-foreground-secondary">
            Cuando se te asigne un área, vas a poder ingresar a las secciones
            correspondientes según los permisos vigentes.
          </p>
          <div className="mt-5">
            <Button
              className="w-full"
              disabled={isLoggingOut}
              onClick={() => void handleLogout()}
              type="button"
              variant="outline"
            >
              {isLoggingOut ? "Desconectando..." : "Desconectarse"}
            </Button>
          </div>
        </header>
      </div>
    </section>
  );
}
