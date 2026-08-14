import { Suspense, lazy } from "react";
import {
  Navigate,
  Route,
  Routes,
  generatePath,
  useParams,
} from "react-router-dom";

import { AppLayout } from "@/app/layouts/app-layout";
import { AuthLayout } from "@/app/layouts/auth-layout";
import {
  AdminOnlyRoute,
  PendingAreaRoute,
  ProtectedRoute,
  PublicOnlyRoute,
  RiesgoOnlyRoute,
} from "@/modules/auth/components/auth-route-guards";
import { LoginPage } from "@/modules/auth/pages/login-page";
import { PendingAreaPage } from "@/modules/auth/pages/pending-area-page";
import { ForgotPasswordPage } from "@/modules/auth/pages/forgot-password-page";
import { RegisterPage } from "@/modules/auth/pages/register-page";
import { ResetPasswordPage } from "@/modules/auth/pages/reset-password-page";
import { VerifyEmailPage } from "@/modules/auth/pages/verify-email-page";
import { SolicitudesContentLoader } from "@/modules/solicitudes-shared/components/solicitudes-content-loader";
import { SolicitudesLoader } from "@/shared/components/ui/solicitudes-loader";

const SolicitudesPrecargaPage = lazy(() =>
  import("@/modules/solicitudes/precarga/pages/solicitudes-precarga-page").then(
    (module) => ({ default: module.SolicitudesPrecargaPage }),
  ),
);
const SolicitudesNuevaPage = lazy(() =>
  import("@/modules/solicitudes-editor/pages/solicitudes-nueva-page").then(
    (module) => ({ default: module.SolicitudesNuevaPage }),
  ),
);
const SolicitudesActualPrecargaPage = lazy(() =>
  import("@/modules/solicitudes-core/pages/solicitudes-actual-precarga-page").then(
    (module) => ({ default: module.SolicitudesActualPrecargaPage }),
  ),
);
const SolicitudesDetallePage = lazy(() =>
  import("@/modules/solicitudes/detalle/pages/solicitud-detalle-page").then(
    (module) => ({ default: module.SolicitudDetallePage }),
  ),
);
const SolicitudesRecientesPage = lazy(() =>
  import("@/modules/solicitudes/recientes/pages/solicitudes-recientes-page").then(
    (module) => ({ default: module.SolicitudesRecientesPage }),
  ),
);
const SolicitudesHistoricasPage = lazy(() =>
  import("@/modules/solicitudes/historicas/pages/solicitudes-historicas-page").then(
    (module) => ({ default: module.SolicitudesHistoricasPage }),
  ),
);
const SolicitudesActualRecientesPage = lazy(() =>
  import("@/modules/solicitudes-core/pages/solicitudes-core-recientes-page").then(
    (module) => ({ default: module.SolicitudesCoreRecientesPage }),
  ),
);
const SolicitudesActualHistoricasPage = lazy(() =>
  import("@/modules/solicitudes-core/pages/solicitudes-core-historicas-page").then(
    (module) => ({ default: module.SolicitudesCoreHistoricasPage }),
  ),
);
const SolicitudesActualDetallePage = lazy(() =>
  import("@/modules/solicitudes-core/pages/solicitudes-actual-detalle-page").then(
    (module) => ({ default: module.SolicitudesActualDetallePage }),
  ),
);
const ResumenEstadoCreditoPorDniPage = lazy(() =>
  import("@/modules/reportes/pages/resumen-estado-credito-por-dni-page").then(
    (module) => ({ default: module.ResumenEstadoCreditoPorDniPage }),
  ),
);
const CreditosPorVendedorPage = lazy(() =>
  import("@/modules/reportes/pages/creditos-por-vendedor-page").then(
    (module) => ({ default: module.CreditosPorVendedorPage }),
  ),
);
const SociosPage = lazy(() =>
  import("@/modules/socios/pages/socios-page").then((module) => ({
    default: module.SociosPage,
  })),
);
const ProfilePage = lazy(() =>
  import("@/modules/auth/pages/profile-page").then((module) => ({
    default: module.ProfilePage,
  })),
);
const LoaderPreviewPage = lazy(() =>
  import("@/modules/dev/pages/loader-preview-page").then((module) => ({
    default: module.LoaderPreviewPage,
  })),
);
const NotFoundPage = lazy(() =>
  import("@/modules/dev/pages/not-found-page").then((module) => ({
    default: module.NotFoundPage,
  })),
);
const AdminUsersPendingPage = lazy(() =>
  import("@/modules/users-admin/pages/admin-users-pending-page").then(
    (module) => ({ default: module.AdminUsersPendingPage }),
  ),
);
const AdminUsersPage = lazy(() =>
  import("@/modules/users-admin/pages/admin-users-page").then((module) => ({
    default: module.AdminUsersPage,
  })),
);
const AdminFieldAccessRulesPage = lazy(() =>
  import("@/modules/solicitudes-core/pages/admin-field-access-rules-page").then(
    (module) => ({
      default: module.AdminFieldAccessRulesPage,
    }),
  ),
);
const AdminWorkflowTransitionsPage = lazy(() =>
  import("@/modules/solicitudes-core/pages/admin-workflow-transitions-page").then(
    (module) => ({
      default: module.AdminWorkflowTransitionsPage,
    }),
  ),
);
const CalculadoraRiesgoPage = lazy(() =>
  import("@/modules/riesgo/pages/calculadora-riesgo-page").then((module) => ({
    default: module.CalculadoraRiesgoPage,
  })),
);
const DashboardHomePage = lazy(() =>
  import("@/modules/dashboard/pages/dashboard-home-page").then((module) => ({
    default: module.DashboardHomePage,
  })),
);
function RouteFallback() {
  return <SolicitudesContentLoader />;
}

function FullPageRouteFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <SolicitudesLoader label="Carga de Solicitudes" size="md" />
    </main>
  );
}

function SolicitudesActualDetalleRedirect() {
  const { id } = useParams<{ id: string }>();

  return (
    <Navigate
      replace
      to={generatePath("/solicitudes/core/detalle/:id", { id: id ?? "" })}
    />
  );
}

export function AppRouter() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <PublicOnlyRoute>
            <Navigate replace to="/login" />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <AuthLayout>
              <LoginPage />
            </AuthLayout>
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnlyRoute>
            <AuthLayout>
              <RegisterPage />
            </AuthLayout>
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/verify-email"
        element={
          <PublicOnlyRoute>
            <AuthLayout>
              <VerifyEmailPage />
            </AuthLayout>
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PublicOnlyRoute>
            <AuthLayout>
              <ForgotPasswordPage />
            </AuthLayout>
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/reset-password"
        element={
          <PublicOnlyRoute>
            <AuthLayout>
              <ResetPasswordPage />
            </AuthLayout>
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/pending-area"
        element={
          <PendingAreaRoute>
            <AuthLayout>
              <PendingAreaPage />
            </AuthLayout>
          </PendingAreaRoute>
        }
      />
      <Route
        path="/404"
        element={
          <Suspense fallback={<FullPageRouteFallback />}>
            <NotFoundPage />
          </Suspense>
        }
      />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route
          path="/dashboard"
          element={
            <Suspense fallback={<RouteFallback />}>
              <DashboardHomePage />
            </Suspense>
          }
        />
        <Route
          path="/solicitudes/core/precarga"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SolicitudesActualPrecargaPage />
            </Suspense>
          }
        />
        <Route
          path="/solicitudes/core/precarga/nueva"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SolicitudesNuevaPage />
            </Suspense>
          }
        />
        <Route
          path="/solicitudes/core/recientes"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SolicitudesActualRecientesPage />
            </Suspense>
          }
        />
        <Route
          path="/solicitudes/core/historicas"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SolicitudesActualHistoricasPage />
            </Suspense>
          }
        />
        <Route
          path="/solicitudes/anterior/precarga"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SolicitudesPrecargaPage />
            </Suspense>
          }
        />
        <Route
          path="/solicitudes/anterior/recientes"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SolicitudesRecientesPage />
            </Suspense>
          }
        />
        <Route
          path="/solicitudes/anterior/historicas"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SolicitudesHistoricasPage />
            </Suspense>
          }
        />
        <Route
          path="/solicitudes/nueva"
          element={<Navigate replace to="/solicitudes/core/precarga/nueva" />}
        />
        <Route
          path="/solicitudes/precarga"
          element={<Navigate replace to="/solicitudes/anterior/precarga" />}
        />
        <Route
          path="/solicitudes/recientes"
          element={<Navigate replace to="/solicitudes/anterior/recientes" />}
        />
        <Route
          path="/solicitudes/historicas"
          element={<Navigate replace to="/solicitudes/anterior/historicas" />}
        />
        <Route
          path="/solicitudes/actual/precarga"
          element={<Navigate replace to="/solicitudes/core/precarga" />}
        />
        <Route
          path="/solicitudes/actual/precarga/nueva"
          element={<Navigate replace to="/solicitudes/core/precarga/nueva" />}
        />
        <Route
          path="/solicitudes/actual/recientes"
          element={<Navigate replace to="/solicitudes/core/recientes" />}
        />
        <Route
          path="/solicitudes/actual/historicas"
          element={<Navigate replace to="/solicitudes/core/historicas" />}
        />
        <Route
          path="/solicitudes/detalle"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SolicitudesDetallePage />
            </Suspense>
          }
        />
        <Route
          path="/solicitudes/core/detalle/:id"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SolicitudesActualDetallePage />
            </Suspense>
          }
        />
        <Route
          path="/solicitudes/actual/detalle/:id"
          element={<SolicitudesActualDetalleRedirect />}
        />
        <Route
          path="/listados/resumen-estado-credito-dni"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ResumenEstadoCreditoPorDniPage />
            </Suspense>
          }
        />
        <Route
          path="/listados/creditos-por-vendedor"
          element={
            <Suspense fallback={<RouteFallback />}>
              <CreditosPorVendedorPage />
            </Suspense>
          }
        />
        <Route
          path="/socios"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SociosPage />
            </Suspense>
          }
        />
        <Route
          path="/perfil"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ProfilePage />
            </Suspense>
          }
        />
        <Route
          path="/dev/loader-preview"
          element={
            <Suspense fallback={<RouteFallback />}>
              <LoaderPreviewPage />
            </Suspense>
          }
        />
        <Route
          path="/admin/solicitudes/field-access-rules"
          element={
            <AdminOnlyRoute>
              <Suspense fallback={<RouteFallback />}>
                <AdminFieldAccessRulesPage />
              </Suspense>
            </AdminOnlyRoute>
          }
        />
        <Route
          path="/admin/solicitudes/workflow-transitions"
          element={
            <AdminOnlyRoute>
              <Suspense fallback={<RouteFallback />}>
                <AdminWorkflowTransitionsPage />
              </Suspense>
            </AdminOnlyRoute>
          }
        />
        <Route
          path="/riesgo/calculadora"
          element={
            <RiesgoOnlyRoute>
              <Suspense fallback={<RouteFallback />}>
                <CalculadoraRiesgoPage />
              </Suspense>
            </RiesgoOnlyRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <AdminOnlyRoute>
              <Suspense fallback={<RouteFallback />}>
                <AdminUsersPage />
              </Suspense>
            </AdminOnlyRoute>
          }
        />
        <Route
          path="/admin/users/pending"
          element={
            <AdminOnlyRoute>
              <Suspense fallback={<RouteFallback />}>
                <AdminUsersPendingPage />
              </Suspense>
            </AdminOnlyRoute>
          }
        />
        <Route
          path="/admin/dashboard"
          element={<Navigate replace to="/dashboard" />}
        />
      </Route>
      <Route path="*" element={<Navigate replace to="/404" />} />
    </Routes>
  );
}
