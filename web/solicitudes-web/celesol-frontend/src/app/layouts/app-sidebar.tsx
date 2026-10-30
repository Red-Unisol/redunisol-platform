import { useState } from "react";
import {
  BarChart3,
  ChevronDown,
  CircleDot,
  ClipboardList,
  FileChartColumn,
  FileCheck2,
  Bell,
  History,
  LayoutDashboard,
  Shield,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { NavLink, useLocation } from "react-router-dom";

import { useAuthSessionQuery } from "@/modules/auth/hooks/use-auth-session";
import {
  canCreateSolicitud,
  canManageUsers,
  canReviewSignatures,
} from "@/modules/auth/utils/auth-user";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

type SidebarGroup = {
  items?: Array<{ icon: LucideIcon; label: string; to: string }>;
  label: string;
  sections?: Array<{
    id: string;
    items: Array<{ icon: LucideIcon; label: string; to: string }>;
    label: string;
  }>;
  id: string;
};

type AppSidebarProps = {
  isDesktop: boolean;
  isOpen: boolean;
  onClose: () => void;
};

const SIDEBAR_GROUPS: SidebarGroup[] = [
  {
    id: "dashboard",
    label: "Inicio",
    items: [
      {
        icon: LayoutDashboard,
        label: "Dashboard",
        to: "/dashboard",
      },
      { icon: Bell, label: "Notificaciones", to: "/notificaciones" },
    ],
  },
  {
    id: "solicitudes",
    label: "Solicitudes",
    sections: [
      {
        id: "solicitudes-core",
        label: "Sistema Actual",
        items: [
          {
            icon: ClipboardList,
            label: "Precarga",
            to: "/solicitudes/core/precarga",
          },
          {
            icon: BarChart3,
            label: "Recientes",
            to: "/solicitudes/core/recientes",
          },
          {
            icon: History,
            label: "Históricas",
            to: "/solicitudes/core/historicas",
          },
        ],
      },
    ],
  },
  {
    id: "listados",
    label: "Listados",
    items: [
      {
        icon: FileChartColumn,
        label: "Estado de créditos por DNI",
        to: "/listados/resumen-estado-credito-dni",
      },
      {
        icon: BarChart3,
        label: "Créditos por vendedor",
        to: "/listados/creditos-por-vendedor",
      },
    ],
  },
  {
    id: "socios",
    label: "Socios",
    items: [
      {
        icon: Users,
        label: "Socios",
        to: "/socios",
      },
    ],
  },
];

// Tocar la lista en la que ya se esta la vuelve a pedir (antes no hacia nada).
const LISTA_QUERY_KEY_POR_RUTA: Record<string, readonly unknown[]> = {
  "/solicitudes/core/precarga": solicitudesCoreQueryKeys.precargaAll,
  "/solicitudes/core/recientes": solicitudesCoreQueryKeys.recientesAll,
  "/solicitudes/core/historicas": solicitudesCoreQueryKeys.historicasAll,
};

export function AppSidebar({ isDesktop, isOpen, onClose }: AppSidebarProps) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const sessionQuery = useAuthSessionQuery();
  const user = sessionQuery.data;
  const sidebarGroups: SidebarGroup[] = [
    ...SIDEBAR_GROUPS.map((group) => ({
      ...group,
      sections: group.sections?.map((section) => ({
        ...section,
        items: section.items.filter(
          (item) =>
            item.to !== "/solicitudes/core/precarga" ||
            canCreateSolicitud(user),
        ),
      })),
    })),
    ...(canReviewSignatures(user)
      ? [
          {
            id: "legajos",
            label: "Legajos Digitales",
            items: [
              {
                icon: FileCheck2,
                label: "Bandeja de firmas",
                to: "/legajos/firmas",
              },
            ],
          },
        ]
      : []),
    ...(canManageUsers(user)
      ? [
          {
            id: "administracion",
            label: "Administración",
            items: [
              {
                icon: Shield,
                label: "Usuarios",
                to: "/admin/users",
              },
              {
                icon: Shield,
                label: "Usuarios pendientes",
                to: "/admin/users/pending",
              },
              {
                icon: Shield,
                label: "Permisos de edición",
                to: "/admin/solicitudes/field-access-rules",
              },
              {
                label: "Reconocimiento de recibos",
                icon: Shield,
                to: "/admin/solicitudes/reconocimiento-recibos",
              },
              {
                icon: Shield,
                label: "Transiciones",
                to: "/admin/solicitudes/workflow-transitions",
              },
            ],
          },
        ]
      : []),
  ];
  // Arranca con Solicitudes abierto y el resto cerrado (más el grupo de la página actual).
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    sidebarGroups.reduce<Record<string, boolean>>((accumulator, group) => {
      const rutas = [
        ...(group.items ?? []),
        ...(group.sections?.flatMap((section) => section.items) ?? []),
      ].map((item) => item.to);
      accumulator[group.id] =
        group.id === "solicitudes" || rutas.includes(location.pathname);
      return accumulator;
    }, {}),
  );

  return (
    <>
      {!isDesktop && isOpen ? (
        <button
          aria-label="Cerrar menú lateral"
          className="fixed inset-0 top-[var(--app-topbar-height,4rem)] z-30 bg-black/40 opacity-100 transition-opacity duration-200 md:hidden"
          onClick={onClose}
          type="button"
        />
      ) : null}

      <aside
        aria-hidden={!isOpen}
        // Cerrado no recibe foco ni clics (si no, Tab entra en links invisibles).
        inert={!isOpen}
        className={`shrink-0 bg-linear-to-b from-marino to-marino-2 font-marca text-white origin-left transition-[width,opacity] duration-300 ease-out ${
          isDesktop
            ? `${isOpen ? "w-52 opacity-100" : "w-0 opacity-0"} overflow-hidden`
            : `fixed top-[var(--app-topbar-height,4rem)] bottom-0 left-0 z-40 w-64 shadow-lg transition-transform duration-300 ease-out ${
                isOpen ? "translate-x-0" : "-translate-x-full"
              }`
        }`}
      >
        <div
          className={`flex h-full flex-col ${isDesktop ? "w-52 min-w-52" : "w-full"}`}
        >
          <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {sidebarGroups.map((group) => (
              <div key={group.label}>
                <button
                  aria-expanded={openGroups[group.id]}
                  className="mb-1.5 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-verde-claro transition hover:text-white"
                  onClick={() =>
                    setOpenGroups((currentGroups) => ({
                      ...currentGroups,
                      [group.id]: !currentGroups[group.id],
                    }))
                  }
                  type="button"
                >
                  <ChevronDown
                    className={`size-3.5 transition-transform ${
                      openGroups[group.id] ? "rotate-0" : "-rotate-90"
                    }`}
                  />
                  <h2 className="text-[0.7rem] font-bold tracking-[0.14em] uppercase">
                    {group.label}
                  </h2>
                </button>

                <div
                  className={`grid transition-all duration-200 ease-out ${
                    openGroups[group.id]
                      ? "grid-rows-[1fr] opacity-100"
                      : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="overflow-hidden">
                    {group.sections?.length ? (
                      <div className="space-y-3">
                        {group.sections.map((section) => (
                          <div className="space-y-1" key={section.id}>
                            {section.items.map((item) => (
                              <NavLink
                                className={({ isActive }) =>
                                  `group flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-sm transition ${
                                    isActive
                                      ? "bg-verde font-semibold text-white"
                                      : "text-marino-foreground-secondary hover:bg-white/10 hover:text-white"
                                  }`
                                }
                                key={item.to}
                                onClick={() => {
                                  const listaKey =
                                    LISTA_QUERY_KEY_POR_RUTA[item.to];
                                  if (
                                    listaKey &&
                                    location.pathname === item.to
                                  ) {
                                    void queryClient.invalidateQueries({
                                      queryKey: listaKey,
                                    });
                                  }
                                  if (!isDesktop) onClose();
                                }}
                                to={item.to}
                              >
                                <item.icon className="size-4 shrink-0" />
                                <span className="leading-tight">
                                  {item.label}
                                </span>
                              </NavLink>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {group.items?.map((item) => (
                          <NavLink
                            className={({ isActive }) =>
                              `group flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-sm transition ${
                                isActive
                                  ? "bg-verde font-semibold text-white"
                                  : "text-marino-foreground-secondary hover:bg-white/10 hover:text-white"
                              }`
                            }
                            key={item.to}
                            onClick={isDesktop ? undefined : onClose}
                            to={item.to}
                          >
                            <item.icon className="size-4 shrink-0" />
                            <span className="leading-tight">{item.label}</span>
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </nav>

          <footer className="border-t border-white/10 px-4 py-3 text-[0.68rem] text-marino-foreground-secondary/70">
            <p>Solicitud de Préstamos Web</p>
            <p className="mt-1">Versión xxxx-xxxx</p>
            <div className="mt-3 flex items-center gap-2">
              <CircleDot className="size-3" />
              <p>Software para Entidades Financieras</p>
            </div>
          </footer>
        </div>
      </aside>
    </>
  );
}
