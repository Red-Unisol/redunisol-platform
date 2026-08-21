import { lazy, Suspense } from "react";

import { useAuthSessionQuery } from "@/modules/auth/hooks/use-auth-session";
import {
  resolveDashboardVariant,
  type DashboardVariant,
} from "@/modules/auth/utils/auth-user";
import { SolicitudesContentLoader } from "@/modules/solicitudes-shared/components/solicitudes-content-loader";

const ROLE_COLORS: Record<DashboardVariant, string> = {
  admin: "#E87722",
  analista: "#059669",
  vendedor: "#3B82F6",
};

const AdminDashboard = lazy(() =>
  import("@/modules/dashboard/admin/components/admin-dashboard").then(
    (module) => ({ default: module.AdminDashboard }),
  ),
);
const DashboardAnalistaV2 = lazy(() =>
  import("@/modules/solicitudes/dashboard/components/dashboard-analista-v2").then(
    (module) => ({ default: module.DashboardAnalistaV2 }),
  ),
);
const DashboardVendedor = lazy(() =>
  import("@/modules/solicitudes/dashboard/components/dashboard-vendedor").then(
    (module) => ({ default: module.DashboardVendedor }),
  ),
);

function DashboardVariantContent({ variant }: { variant: DashboardVariant }) {
  if (variant === "admin") {
    return <AdminDashboard />;
  }

  if (variant === "analista") {
    return <DashboardAnalistaV2 />;
  }

  return <DashboardVendedor />;
}

export function DashboardHomePage() {
  const sessionQuery = useAuthSessionQuery();

  if (sessionQuery.isPending || !sessionQuery.data) {
    return <SolicitudesContentLoader />;
  }

  const variant = resolveDashboardVariant(sessionQuery.data);

  const roleColor = ROLE_COLORS[variant];

  return (
    <div
      className="h-full"
      style={
        {
          display: "flex",
          flexDirection: "column",
          "--role-color": roleColor,
        } as React.CSSProperties
      }
    >
      {/* Role-color accent — separate from scroll container so content never goes behind it */}
      <div style={{ background: roleColor, flexShrink: 0, height: 3 }} />
      <div
        style={{
          background: "#F0F2F5",
          flex: 1,
          overflowX: "hidden",
          overflowY: "auto",
        }}
      >
        <Suspense fallback={<SolicitudesContentLoader />}>
          <DashboardVariantContent variant={variant} />
        </Suspense>
      </div>
    </div>
  );
}
