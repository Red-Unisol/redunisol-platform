import { useState, type ComponentProps } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, RefreshCw } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "@/shared/services/http/api-client";
import { Button } from "@/shared/components/ui/button";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { useAuthSessionQuery } from "@/modules/auth/hooks/use-auth-session";

type Notification = {
  id: string;
  title: string;
  body: string;
  solicitudId: string;
  createdAt: string;
  readAt: string | null;
  kind: string;
};
type NotificationsResponse = {
  items: Notification[];
  unreadCount: number;
  total: number;
  offset: number;
  limit: number;
};
const notificationKey = ["notifications"] as const;

function useNotifications(unreadOnly = false, offset = 0, limit = 20) {
  const session = useAuthSessionQuery();
  return useQuery({
    queryKey: [...notificationKey, session.data?.id, unreadOnly, offset, limit],
    enabled: Boolean(session.data?.id),
    queryFn: () =>
      apiClient.get<NotificationsResponse>(
        `/api/notifications?offset=${offset}&limit=${limit}${unreadOnly ? "&unreadOnly=true" : ""}`,
      ),
    refetchInterval: 20000,
  });
}
const date = (value: string) =>
  new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(value));

function NotificationList({
  compact = false,
  onNavigate,
}: {
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const limit = compact ? 8 : 20;
  const query = useNotifications(unreadOnly, offset, limit);
  const client = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: (id: string | null) =>
      apiClient.post(
        id ? `/api/notifications/${id}/read` : "/api/notifications/read-all",
        {},
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: notificationKey }),
  });
  const items = query.data?.items;
  async function open(item: Notification) {
    if (!item.readAt) {
      try {
        await mutation.mutateAsync(item.id);
      } catch {
        /* The unread marker is retained if the request failed. */
      }
    }
    onNavigate?.();
    navigate(
      `/solicitudes/core/detalle/${encodeURIComponent(item.solicitudId)}`,
    );
  }
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
        <h2 className="font-semibold">
          Notificaciones{" "}
          {query.data ? `(${query.data.unreadCount} sin leer)` : ""}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          disabled={mutation.isPending || !query.data?.unreadCount}
          onClick={() => {
            setOffset(0);
            mutation.mutate(null);
          }}
        >
          <CheckCheck className="size-4" />
          Marcar leídas
        </Button>
        {!compact && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(event) => {
                setUnreadOnly(event.target.checked);
                setOffset(0);
              }}
            />
            Sólo sin leer
          </label>
        )}
      </div>
      {query.isPending && (
        <p className="p-4 text-sm" role="status">
          Cargando notificaciones…
        </p>
      )}
      {query.error && (
        <div role="alert" className="p-4 text-sm">
          <p>No se pudieron consultar las notificaciones.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void query.refetch()}
          >
            <RefreshCw className="size-4" />
            Reintentar
          </Button>
        </div>
      )}
      {mutation.error && (
        <p role="alert" className="p-4 text-sm text-destructive">
          No se pudo marcar la notificación como leída. Podés volver a
          intentarlo.
        </p>
      )}
      {!query.isPending && !query.error && !items?.length && (
        <p className="p-6 text-sm text-foreground-secondary">
          No hay notificaciones {unreadOnly ? "sin leer" : "todavía"}.
        </p>
      )}
      <NotificationItems
        items={items ?? []}
        compact={compact}
        busy={mutation.isPending}
        onOpen={(item) => void open(item)}
      />
      {!compact && query.data && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
          <p className="text-xs text-foreground-secondary">
            {query.data.total} aviso(s).{" "}
            {query.data.total > 0
              ? `Mostrando ${offset + 1}–${Math.min(offset + query.data.items.length, query.data.total)}.`
              : ""}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={offset === 0 || query.isFetching}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={offset + limit >= query.data.total || query.isFetching}
              onClick={() => setOffset(offset + limit)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
      <p className="border-t border-border px-4 py-3 text-xs text-foreground-secondary">
        Leer un aviso no resuelve la tarea pendiente de la solicitud.
      </p>
      {compact && (
        <Link
          to="/notificaciones"
          onClick={onNavigate}
          className="block border-t border-border p-3 text-center text-sm font-medium text-primary"
        >
          Ver todas las notificaciones
        </Link>
      )}
    </div>
  );
}

export function NotificationBell() {
  const query = useNotifications(false, 0, 8);
  const [open, setOpen] = useState(false);
  const count = query.data?.unreadCount ?? 0;
  return (
    <PopoverRoot open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <NotificationBellButton count={count} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(26rem,calc(100vw-2rem))] overflow-hidden p-0"
        sideOffset={8}
      >
        <NotificationList compact onNavigate={() => setOpen(false)} />
      </PopoverContent>
    </PopoverRoot>
  );
}

export function NotificationsPage() {
  return (
    <main className="mx-auto w-full max-w-4xl p-4 md:p-6">
      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <NotificationList />
      </section>
    </main>
  );
}

export function NotificationItems({
  items,
  compact = false,
  busy = false,
  onOpen,
}: {
  items: Notification[];
  compact?: boolean;
  busy?: boolean;
  onOpen: (item: Notification) => void;
}) {
  return (
    <ul
      className={
        compact ? "max-h-96 overflow-y-auto" : "divide-y divide-border"
      }
    >
      {items?.map((item) => (
        <li
          key={item.id}
          className={`border-b border-border last:border-b-0 ${item.readAt ? "" : "bg-primary/5"}`}
        >
          <button
            type="button"
            className="w-full space-y-1 px-4 py-3 text-left transition hover:bg-background disabled:opacity-60"
            disabled={busy}
            onClick={() => onOpen(item)}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              {!item.readAt && (
                <span
                  className="size-2 shrink-0 rounded-full bg-primary"
                  aria-label="Sin leer"
                />
              )}
              {item.title}
            </span>
            <span className="block whitespace-pre-wrap text-sm text-foreground-secondary">
              {item.body}
            </span>
            <span className="block text-xs text-foreground-muted">
              {date(item.createdAt)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function NotificationBellButton({
  count,
  ...props
}: ComponentProps<"button"> & { count: number }) {
  return (
    <button
      {...props}
      type="button"
      aria-label={`Notificaciones${count ? `: ${count} sin leer` : ""}`}
      className="relative inline-flex size-9 items-center justify-center rounded-md text-foreground-secondary hover:bg-background"
    >
      <Bell className="size-5" />
      {count > 0 && (
        <span
          className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-white"
          aria-hidden="true"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
