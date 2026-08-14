import { useState } from "react";
import {
  BarChart3,
  ChevronDown,
  CircleDot,
  ClipboardList,
  FileChartColumn,
  History,
  LayoutDashboard,
  Search,
  Shield,
  Users,
  type LucideIcon,
} from "lucide-react";
import { NavLink } from "react-router-dom";

import { useAuthSessionQuery } from "@/modules/auth/hooks/use-auth-session";
import { canManageUsers } from "@/modules/auth/utils/auth-user";
import { Input } from "@/shared/components/ui/input";

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
        label: "Resumen Estado Crédito por DNI",
        to: "/listados/resumen-estado-credito-dni",
      },
      {
        icon: BarChart3,
        label: "Créditos por Vendedor",
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

export function AppSidebar({ isDesktop, isOpen, onClose }: AppSidebarProps) {
  const sessionQuery = useAuthSessionQuery();
  const user = sessionQuery.data;
  const [searchTerm, setSearchTerm] = useState("");
  const sidebarGroups = [
    ...SIDEBAR_GROUPS,
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
                icon: Shield,
                label: "Transiciones",
                to: "/admin/solicitudes/workflow-transitions",
              },
            ],
          },
        ]
      : []),
  ];
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    sidebarGroups.reduce<Record<string, boolean>>((accumulator, group) => {
      accumulator[group.id] = true;
      return accumulator;
    }, {}),
  );

  return (
    <>
      {!isDesktop && isOpen ? (
        <button
          aria-label="Cerrar menú lateral"
          className="fixed inset-0 z-30 bg-black/30 opacity-100 transition-opacity duration-200 md:hidden"
          onClick={onClose}
          type="button"
        />
      ) : null}

      <aside
        aria-hidden={!isOpen}
        className={`shrink-0 bg-surface origin-left transition-[width,opacity] duration-300 ease-out ${
          isDesktop
            ? `border-r border-border ${isOpen ? "w-72 opacity-100" : "w-0 opacity-0"} overflow-hidden`
            : `fixed top-16 bottom-0 left-0 z-40 w-72 border-r border-border shadow-lg transition-transform duration-300 ease-out ${
                isOpen ? "translate-x-0" : "-translate-x-full"
              }`
        }`}
      >
        <div
          className={`flex h-full flex-col ${isDesktop ? "w-72 min-w-72" : "w-full"}`}
        >
          <div className="border-b border-border px-3 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
              <Input
                aria-label="Buscar en el menú"
                className="pl-9"
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Filtrar..."
                value={searchTerm}
              />
            </div>
          </div>

          <nav className="flex-1 space-y-3 overflow-y-auto px-2 py-4">
            {sidebarGroups.map((group) => (
              <div key={group.label}>
                <button
                  aria-expanded={openGroups[group.id]}
                  className="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-foreground transition hover:bg-background"
                  onClick={() =>
                    setOpenGroups((currentGroups) => ({
                      ...currentGroups,
                      [group.id]: !currentGroups[group.id],
                    }))
                  }
                  type="button"
                >
                  <ChevronDown
                    className={`size-4 text-foreground-secondary transition-transform ${
                      openGroups[group.id] ? "rotate-0" : "-rotate-90"
                    }`}
                  />
                  <h2 className="text-[1rem] font-medium">{group.label}</h2>
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
                      <div className="space-y-3 pl-4">
                        {group.sections.map((section) => (
                          <div className="space-y-1" key={section.id}>
                            <p className="px-3.5 text-xs font-semibold uppercase tracking-wide text-foreground-secondary">
                              {section.label}
                            </p>
                            {section.items.map((item) => (
                              <NavLink
                                className={({ isActive }) =>
                                  `group flex min-h-9 items-center gap-2 rounded-md px-3.5 text-[1.02rem] transition ${
                                    isActive
                                      ? "bg-primary text-primary-foreground"
                                      : "text-foreground hover:bg-background"
                                  }`
                                }
                                key={item.to}
                                onClick={isDesktop ? undefined : onClose}
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
                      <div className="space-y-1 pl-4">
                        {group.items?.map((item) => (
                          <NavLink
                            className={({ isActive }) =>
                              `group flex min-h-9 items-center gap-2 rounded-md px-3.5 text-[1.02rem] transition ${
                                isActive
                                  ? "bg-primary text-primary-foreground"
                                  : "text-foreground hover:bg-background"
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

          <footer className="border-t border-border px-3 py-4 text-xs text-foreground-muted">
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
