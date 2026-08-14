import {
  CircleAlert,
  LogOut,
  Menu,
  Pencil,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  useAuthSessionQuery,
  useLogoutMutation,
} from "@/modules/auth/hooks/use-auth-session";
import { Avatar, AvatarFallback } from "@/shared/components/ui/avatar";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { Separator } from "@/shared/components/ui/separator";

type AppTopbarProps = {
  titleIcon: LucideIcon;
  title?: string | null;
  titleBadge?: string | null;
  onToggleSidebar: () => void;
};

const LOGOUT_REQUEST_TOAST_ID = "logout-request-error";

function getInitials(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallback: string,
) {
  const first = firstName?.trim().charAt(0) ?? "";
  const last = lastName?.trim().charAt(0) ?? "";
  const initials = `${first}${last}`.toUpperCase();

  return initials || fallback.charAt(0).toUpperCase() || "?";
}

export function AppTopbar({
  titleIcon: TitleIcon,
  title,
  titleBadge,
  onToggleSidebar,
}: AppTopbarProps) {
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const logoutMutation = useLogoutMutation();
  const sessionQuery = useAuthSessionQuery();
  const user = sessionQuery.data;
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  const displayName = fullName || user?.legacyUser || user?.email || "Usuario";
  const secondaryIdentifier =
    user?.email && user.email !== displayName
      ? user.email
      : user?.legacyUser && user.legacyUser !== displayName
        ? user.legacyUser
        : null;
  const initials = getInitials(user?.firstName, user?.lastName, displayName);

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
        id: LOGOUT_REQUEST_TOAST_ID,
        icon: <CircleAlert className="size-5" />,
        duration: 3500,
      });
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-4">
      <div className="flex items-center gap-4">
        <button
          aria-label="Mostrar u ocultar menú lateral"
          className="inline-flex size-9 items-center justify-center rounded-md text-foreground-secondary transition hover:bg-background hover:text-foreground"
          onClick={onToggleSidebar}
          type="button"
        >
          <Menu className="size-5" />
        </button>
        <div className="flex items-center gap-3 md:ml-[15.25rem]">
          <TitleIcon className="size-6 shrink-0 text-foreground-secondary" />
          <div className="flex items-center gap-3">
            {title ? (
              <h1 className="text-[1.85rem] leading-none font-semibold text-foreground">
                {title}
              </h1>
            ) : null}
            {titleBadge ? (
              <span className="inline-flex items-center rounded-full border border-input-border bg-background px-3 py-1 text-sm font-medium text-foreground-secondary">
                {titleBadge}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <PopoverRoot>
          <PopoverTrigger asChild>
            <button
              aria-label="Usuario"
              className="inline-flex size-9 items-center justify-center rounded-md transition hover:bg-background"
              type="button"
            >
              <Avatar className="size-7">
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
            </button>
          </PopoverTrigger>

          <PopoverContent
            align="end"
            className="w-[18rem] overflow-hidden rounded-md border-border p-0"
            side="bottom"
            sideOffset={8}
          >
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Avatar className="size-10">
                <AvatarFallback className="text-sm">{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {displayName}
                </p>
                {secondaryIdentifier ? (
                  <p className="truncate text-xs text-foreground-secondary">
                    {secondaryIdentifier}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="p-1.5">
              <button
                className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition hover:bg-background"
                onClick={() => navigate("/perfil")}
                type="button"
              >
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft/20 text-primary">
                  <Pencil className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground">
                    Mis datos
                  </span>
                  <span className="block text-xs text-foreground-secondary">
                    Editar información personal
                  </span>
                </span>
              </button>
            </div>

            <Separator />

            <div className="p-1.5">
              <button
                className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-destructive transition hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
                disabled={isLoggingOut}
                onClick={handleLogout}
                type="button"
              >
                <LogOut className="size-4 shrink-0" />
                <span className="text-sm font-medium">
                  {isLoggingOut ? "Desconectando..." : "Desconectarse"}
                </span>
              </button>
            </div>
          </PopoverContent>
        </PopoverRoot>

        <button
          aria-label="Configuración"
          className="inline-flex size-9 items-center justify-center rounded-md text-foreground-secondary transition hover:bg-background hover:text-foreground"
          type="button"
        >
          <Settings className="size-5" />
        </button>
      </div>
    </header>
  );
}
