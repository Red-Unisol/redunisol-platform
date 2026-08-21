import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
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
  getSolicitudCoreDetailOriginLabel,
  getSolicitudDetailOriginLabel,
} from "@/modules/solicitudes/utils/solicitud-detail-navigation";

const TITLE_BY_PATH: Record<string, string> = {
  "/404": "Página no encontrada",
  "/dev/loader-preview": "Preview Loader",
  "/listados/creditos-por-vendedor": "Créditos por Vendedor",
  "/listados/resumen-estado-credito-dni": "Resumen Estado Crédito por DNI",
  "/admin/solicitudes/field-access-rules":
    "Administración de permisos de edición",
  "/admin/solicitudes/workflow-transitions": "Administración de transiciones",
  "/socios": "Socios",
  "/dashboard": "Dashboard",
  "/perfil": "Mis datos",
  "/admin/dashboard": "Dashboard",
  "/admin/users": "Usuarios",
  "/admin/users/pending": "Usuarios pendientes",
  "/riesgo/calculadora": "Calculadora Mutual",
  "/solicitudes/core/detalle/:id": "Sistema Actual - Detalle de Solicitud",
  "/solicitudes/core/historicas": "Sistema Actual - Solicitudes Históricas",
  "/solicitudes/core/precarga": "Sistema Actual - Solicitudes Precarga",
  "/solicitudes/core/precarga/nueva": "Sistema Actual - Nueva Solicitud",
  "/solicitudes/core/recientes": "Sistema Actual - Solicitudes Recientes",
  "/solicitudes/actual/detalle/:id": "Sistema Actual - Detalle de Solicitud",
  "/solicitudes/actual/historicas": "Sistema Actual - Solicitudes Históricas",
  "/solicitudes/actual/precarga": "Sistema Actual - Solicitudes Precarga",
  "/solicitudes/actual/precarga/nueva": "Sistema Actual - Nueva Solicitud",
  "/solicitudes/actual/recientes": "Sistema Actual - Solicitudes Recientes",
  "/solicitudes/anterior/historicas":
    "Sistema Anterior - Solicitudes Históricas",
  "/solicitudes/anterior/precarga": "Sistema Anterior - Solicitudes Precarga",
  "/solicitudes/anterior/recientes": "Sistema Anterior - Solicitudes Recientes",
  "/solicitudes/detalle": "Detalle de Solicitud",
};

const TITLE_ICON_BY_PATH: Record<string, LucideIcon> = {
  "/404": History,
  "/dev/loader-preview": ClipboardList,
  "/listados/creditos-por-vendedor": BarChart3,
  "/listados/resumen-estado-credito-dni": FileChartColumn,
  "/admin/solicitudes/field-access-rules": Shield,
  "/admin/solicitudes/workflow-transitions": Shield,
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

  const title = useMemo(() => {
    if (
      pathname === "/solicitudes/detalle" ||
      pathname.startsWith("/solicitudes/core/detalle/") ||
      pathname.startsWith("/solicitudes/actual/detalle/")
    ) {
      return null;
    }

    return TITLE_BY_PATH[pathname];
  }, [pathname]);
  const titleBadge = useMemo(() => {
    if (pathname === "/solicitudes/detalle") {
      return getSolicitudDetailOriginLabel(origen);
    }

    if (
      pathname.startsWith("/solicitudes/core/detalle/") ||
      pathname.startsWith("/solicitudes/actual/detalle/")
    ) {
      return getSolicitudCoreDetailOriginLabel(origen);
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
    <main className="min-h-screen bg-background text-foreground">
      <AppTopbar
        onToggleSidebar={() =>
          setIsSidebarOpen((currentState) => !currentState)
        }
        titleBadge={titleBadge}
        title={title}
        titleIcon={titleIcon}
      />

      <div className="relative flex h-[calc(100vh-4rem)]">
        <AppSidebar
          isDesktop={isDesktop}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />
        <section
          className={`relative flex-1 p-2 md:p-1 ${
            isScrollableContentRoute
              ? "overflow-y-auto overflow-x-hidden"
              : "overflow-hidden"
          }`}
          id="app-content-shell"
        >
          <Outlet />
          <div
            className="pointer-events-none absolute inset-0 z-50"
            id="app-content-overlays"
          />
        </section>
      </div>
    </main>
  );
}
