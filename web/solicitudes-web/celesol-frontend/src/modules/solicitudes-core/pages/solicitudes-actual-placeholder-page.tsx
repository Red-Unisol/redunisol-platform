type SolicitudesActualPlaceholderPageProps = {
  description: string;
  title: string;
};

function SolicitudesActualPlaceholderPage({
  description,
  title,
}: SolicitudesActualPlaceholderPageProps) {
  return (
    <article className="flex h-full min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-8">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        <p className="mt-3 text-sm text-foreground-secondary sm:text-base">
          {description}
        </p>
      </div>
    </article>
  );
}

export function SolicitudesActualRecientesPage() {
  return (
    <SolicitudesActualPlaceholderPage
      description="La vista de solicitudes recientes del sistema actual todavía no está implementada."
      title="Sistema Actual - Solicitudes Recientes"
    />
  );
}

export function SolicitudesActualHistoricasPage() {
  return (
    <SolicitudesActualPlaceholderPage
      description="La vista de solicitudes históricas del sistema actual todavía no está implementada."
      title="Sistema Actual - Solicitudes Históricas"
    />
  );
}

export function SolicitudesActualDetallePlaceholderPage() {
  return (
    <SolicitudesActualPlaceholderPage
      description="El detalle y la edición de solicitudes del sistema actual todavía no están implementados."
      title="Sistema Actual - Detalle de Solicitud"
    />
  );
}
