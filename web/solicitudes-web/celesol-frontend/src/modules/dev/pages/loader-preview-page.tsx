import { SolicitudesLoader } from "@/shared/components/ui/solicitudes-loader";

export function LoaderPreviewPage() {
  return (
    <article className="flex h-full min-h-0 items-center justify-center rounded-md border border-border bg-surface shadow-sm">
      <SolicitudesLoader />
    </article>
  );
}
