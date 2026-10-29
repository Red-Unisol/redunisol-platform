import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bell,
  FileCheck2,
  Calculator,
  ClipboardList,
  FileChartColumn,
  FileText,
  History,
  Pencil,
  Shield,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  Navigate,
  Outlet,
  useLocation,
  useSearchParams,
} from "react-router-dom";

import { AppSidebar } from "@/app/layouts/app-sidebar";
import { AppTopbar } from "@/app/layouts/app-topbar";
import { useAuthSessionQuery } from "@/modules/auth/hooks/use-auth-session";
import { getDefaultAuthenticatedRoute } from "@/modules/auth/utils/auth-user";
import {
  getSolicitudCoreDetailOriginLink,
  getSolicitudDetailOriginLabel,
} from "@/modules/solicitudes/utils/solicitud-detail-navigation";

const TITLE_BY_PATH: Record<string, string> = {
  "/notificaciones": "Notificaciones",
  "/legajos/firmas": "Legajos Digitales",
  "/404": "Página no encontrada",
  "/dev/loader-preview": "Preview Loader",
  "/listados/creditos-por-vendedor": "Créditos por vendedor",
  "/listados/resumen-estado-credito-dni": "Estado de créditos por DNI",
  "/admin/solicitudes/field-access-rules": "Permisos de edición",
  "/admin/solicitudes/workflow-transitions": "Transiciones",
  "/admin/solicitudes/reconocimiento-recibos": "Reconocimiento de recibos",
  "/socios": "Socios",
  "/dashboard": "Dashboard",
  "/perfil": "Mis datos",
  "/admin/dashboard": "Dashboard",
  "/admin/users": "Usuarios",
  "/admin/users/pending": "Usuarios pendientes",
  "/riesgo/calculadora": "Calculadora Mutual",
  "/solicitudes/core/detalle/:id": "Detalle de la solicitud",
  "/solicitudes/core/historicas": "Solicitudes históricas",
  "/solicitudes/core/precarga": "Precarga",
  "/solicitudes/core/precarga/nueva": "Nueva solicitud",
  "/solicitudes/core/recientes": "Solicitudes recientes",
  "/solicitudes/actual/detalle/:id": "Detalle de la solicitud",
  "/solicitudes/actual/historicas": "Solicitudes históricas",
  "/solicitudes/actual/precarga": "Precarga",
  "/solicitudes/actual/precarga/nueva": "Nueva solicitud",
  "/solicitudes/actual/recientes": "Solicitudes recientes",
  "/solicitudes/anterior/historicas": "Históricas del sistema anterior",
  "/solicitudes/anterior/precarga": "Precarga del sistema anterior",
  "/solicitudes/anterior/recientes": "Recientes del sistema anterior",
  "/solicitudes/detalle": "Detalle de la solicitud",
};

const TITLE_ICON_BY_PATH: Record<string, LucideIcon> = {
  "/notificaciones": Bell,
  "/legajos/firmas": FileCheck2,
  "/404": History,
  "/dev/loader-preview": ClipboardList,
  "/listados/creditos-por-vendedor": BarChart3,
  "/listados/resumen-estado-credito-dni": FileChartColumn,
  "/admin/solicitudes/field-access-rules": Shield,
  "/admin/solicitudes/workflow-transitions": Shield,
  "/admin/solicitudes/reconocimiento-recibos": Shield,
  "/socios": Users,
  "/dashboard": BarChart3,
  "/perfil": Pencil,
  "/admin/dashboard": BarChart3,
  "/admin/users": Shield,
  "/admin/users/pending": Shield,
  "/riesgo/calculadora": Calculator,
  "/solicitudes/core/detalle/:id": FileText,
  "/solicitudes/core/historicas": History,
  "/solicitudes/core/precarga": ClipboardList,
  "/solicitudes/core/precarga/nueva": ClipboardList,
  "/solicitudes/core/recientes": BarChart3,
  "/solicitudes/actual/detalle/:id": FileText,
  "/solicitudes/actual/historicas": History,
  "/solicitudes/actual/precarga": ClipboardList,
  "/solicitudes/actual/precarga/nueva": ClipboardList,
  "/solicitudes/actual/recientes": BarChart3,
  "/solicitudes/anterior/historicas": History,
  "/solicitudes/anterior/precarga": ClipboardList,
  "/solicitudes/anterior/recientes": BarChart3,
  "/solicitudes/detalle": FileText,
};

export function AppLayout() {
  const sessionQuery = useAuthSessionQuery();
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 768);
  const [isSidebarOpen, setIsSidebarOpen] = useState(
    () => window.innerWidth >= 768,
  );
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const origen = searchParams.get("origen");
  const compactHeader =
    pathname.startsWith("/solicitudes/core/detalle/") ||
    pathname.startsWith("/solicitudes/actual/detalle/");

  const isCoreDetalle =
    pathname.startsWith("/solicitudes/core/detalle/") ||
    pathname.startsWith("/solicitudes/actual/detalle/");
  // En el detalle, la barra lleva "← Precarga" (o la lista de origen) y el título.
  const backLink = useMemo(() => {
    if (isCoreDetalle) return getSolicitudCoreDetailOriginLink(origen);
    if (pathname === "/solicitudes/core/precarga/nueva") {
      return { label: "Precarga", to: "/solicitudes/core/precarga" };
    }
    return null;
  }, [isCoreDetalle, origen, pathname]);
  const title = useMemo(() => {
    if (isCoreDetalle) {
      return "Detalle de la solicitud";
    }

    if (pathname === "/solicitudes/detalle") {
      return null;
    }

    return TITLE_BY_PATH[pathname];
  }, [isCoreDetalle, pathname]);
  const titleBadge = useMemo(() => {
    if (pathname === "/solicitudes/detalle") {
      return getSolicitudDetailOriginLabel(origen);
    }

    return null;
  }, [origen, pathname]);
  const titleIcon = useMemo(() => {
    if (pathname.startsWith("/solicitudes/core/detalle/")) {
      return TITLE_ICON_BY_PATH["/solicitudes/core/detalle/:id"];
    }

    if (pathname.startsWith("/solicitudes/actual/detalle/")) {
      return TITLE_ICON_BY_PATH["/solicitudes/actual/detalle/:id"];
    }

    return TITLE_ICON_BY_PATH[pathname];
  }, [pathname]);
  const isScrollableContentRoute =
    pathname === "/notificaciones" ||
    pathname === "/legajos/firmas" ||
    pathname === "/solicitudes/core/precarga/nueva" ||
    pathname === "/solicitudes/core/precarga" ||
    pathname.startsWith("/solicitudes/core/detalle/") ||
    pathname === "/solicitudes/actual/precarga/nueva" ||
    pathname === "/solicitudes/actual/precarga" ||
    pathname.startsWith("/solicitudes/actual/detalle/") ||
    pathname === "/solicitudes/detalle" ||
    pathname === "/perfil";

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 768px)");

    const syncSidebar = (matches: boolean) => {
      setIsDesktop(matches);
      setIsSidebarOpen(matches);
    };

    syncSidebar(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      syncSidebar(event.matches);
    };

    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  if (!title && !titleBadge) {
    return (
      <Navigate
        replace
        to={
          sessionQuery.data
            ? getDefaultAuthenticatedRoute(sessionQuery.data)
            : "/solicitudes/core/precarga"
        }
      />
    );
  }

  return (
    <main
      className={`app-layout flex h-dvh min-h-0 flex-col bg-background text-foreground ${compactHeader ? "has-compact-header" : ""}`}
    >
      <AppTopbar
        compact={compactHeader}
        onToggleSidebar={() =>
          setIsSidebarOpen((currentState) => !currentState)
        }
        backLink={backLink}
        titleBadge={titleBadge}
        title={title}
        titleIcon={titleIcon}
      />

      {/* Fondo marino detrás del contenido: la esquina redondeada lo deja ver como un marco. */}
      <div className="relative flex min-h-0 flex-1 bg-marino">
        <AppSidebar
          isDesktop={isDesktop}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />
        <section
          className={`relative min-w-0 flex-1 bg-background p-2 md:rounded-tl-2xl md:p-1 ${
            isScrollableContentRoute
              ? "overflow-y-auto overflow-x-hidden"
              : "overflow-hidden"
          }`}
          id="app-content-shell"
        >
          <Outlet context={{ closeSidebar: () => setIsSidebarOpen(false) }} />
          <div
            className="pointer-events-none absolute inset-0 z-50"
            id="app-content-overlays"
          />
        </section>
      </div>
    </main>
  );
}
