import {
  ArrowLeft,
  ChevronRight,
  CircleAlert,
  LogOut,
  Menu,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { NotificationBell } from "@/modules/notifications/notification-center";

type AppTopbarProps = {
  compact?: boolean;
  titleIcon: LucideIcon;
  title?: string | null;
  titleBadge?: string | null;
  backLink?: { label: string; to: string } | null;
  // Contenedor que la pagina completa por portal (cabecera del detalle).
  slotRef?: (element: HTMLDivElement | null) => void;
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
  compact = false,
  titleIcon: TitleIcon,
  title,
  titleBadge,
  backLink,
  slotRef,
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
    <header
      data-compact={compact || undefined}
      className={`app-topbar flex shrink-0 items-center justify-between bg-marino pr-4 font-marca text-white ${
        compact ? "h-[var(--app-topbar-height,2.5rem)]" : "h-16"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center">
        {/* Mismo ancho que el menú lateral (w-52) para que el título arranque sobre el contenido. */}
        <div className="flex shrink-0 items-center gap-2 px-3 md:w-52">
          <button
            aria-label="Mostrar u ocultar menú lateral"
            className="inline-flex size-9 items-center justify-center rounded-md text-marino-foreground-secondary transition hover:bg-white/10 hover:text-white"
            onClick={onToggleSidebar}
            type="button"
          >
            <Menu className="size-5" />
          </button>
          {/* En el detalle (barra compacta) solo queda el menu, para ganar alto. */}
          <div className={`hidden leading-tight ${compact ? "" : "md:block"}`}>
            <p className="text-[0.95rem] font-bold">Redunisol</p>
            <p className="text-[0.62rem] font-bold tracking-[0.14em] text-verde-claro uppercase">
              Solicitudes
            </p>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2.5 md:pl-4">
          {backLink ? (
            <>
              <Link
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium text-marino-foreground-secondary transition hover:bg-white/20 hover:text-white focus-visible:ring-2 focus-visible:ring-verde-claro focus-visible:outline-none"
                aria-label={`Volver a ${backLink.label}`}
                to={backLink.to}
              >
                <ArrowLeft className="size-4" />
                {/* En celular queda solo la flecha: el lugar es para la solicitud. */}
                <span className="hidden sm:inline">{backLink.label}</span>
              </Link>
              {title ? (
                <ChevronRight
                  aria-hidden
                  className="hidden size-4 shrink-0 text-marino-foreground-secondary/60 sm:block"
                />
              ) : null}
            </>
          ) : (
            <TitleIcon className="size-5 shrink-0 text-verde-claro" />
          )}
          <div className="flex min-w-0 items-center gap-3">
            {title ? (
              <h1 className="truncate text-lg leading-none font-semibold md:text-xl">
                {title}
              </h1>
            ) : null}
            {titleBadge ? (
              <span className="inline-flex shrink-0 items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-marino-foreground-secondary">
                {titleBadge}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 items-center" ref={slotRef} />
      </div>

      <div
        className={`flex shrink-0 items-center ${compact ? "gap-1" : "gap-2"}`}
      >
        <NotificationBell />
        <PopoverRoot>
          <PopoverTrigger asChild>
            <button
              aria-label="Usuario"
              className="inline-flex size-9 items-center justify-center rounded-md transition hover:bg-white/10"
              type="button"
            >
              <Avatar className="size-7">
                <AvatarFallback className="bg-verde text-xs font-semibold text-white">
                  {initials}
                </AvatarFallback>
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
      </div>
    </header>
  );
}
