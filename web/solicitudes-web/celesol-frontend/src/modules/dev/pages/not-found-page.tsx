import { AlertTriangle, ArrowLeft, House } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/shared/components/ui/button";

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <article className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-8 sm:px-6">
      <div className="w-full max-w-xl rounded-xl border border-border-soft bg-surface p-6 text-center shadow-sm sm:p-8">
        <div className="mx-auto mb-4 inline-flex size-14 items-center justify-center rounded-full bg-primary/12 text-primary sm:size-16">
          <AlertTriangle className="size-7 sm:size-8" />
        </div>

        <p className="text-sm font-semibold tracking-wide text-primary">
          Error 404
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground sm:text-3xl">
          Página no encontrada
        </h1>
        <p className="mt-3 text-sm text-foreground-secondary sm:text-base">
          La ruta que intentaste abrir no existe o fue movida.
        </p>

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <Button
            onClick={() => navigate("/solicitudes/core/precarga")}
            size="sm"
            type="button"
          >
            <House className="size-4" />
            Ir a Solicitudes
          </Button>
          <Button
            onClick={() => navigate(-1)}
            size="sm"
            type="button"
            variant="outline"
          >
            <ArrowLeft className="size-4" />
            Volver
          </Button>
        </div>
      </div>
    </article>
  );
}
